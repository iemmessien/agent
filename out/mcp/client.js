"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpClient = void 0;
exports.formatToolCallResult = formatToolCallResult;
exports.normalizeMcpConfig = normalizeMcpConfig;
const child_process_1 = require("child_process");
const payload_1 = require("../payload");
const log = (msg) => console.log('[Freekit][mcp]', msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Comenzi care pe Windows sunt shim-uri .cmd/.bat (au nevoie de shell). */
const WIN_SHIM_RE = /^(npx|npm|pnpm|yarn|node|deno|bun)$/i;
/**
 * Pe Windows, fișierele .cmd/.bat NU mai pot fi spawn-uite direct din Node
 * modern (EINVAL, CVE-2024-27980) — le rulăm prin shell, cu argumente
 * citate pentru cmd.exe.
 */
function quoteForCmd(arg) {
    if (arg === '')
        return '""';
    if (!/[\s"^&|<>%!]/.test(arg))
        return arg;
    return ('"' +
        arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') +
        '"');
}
function spawnServer(config) {
    const env = { ...process.env, ...(config.env || {}) };
    const base = {
        cwd: config.cwd,
        env,
        stdio: 'pipe',
        windowsHide: true
    };
    const isWin = process.platform === 'win32';
    const needsShell = isWin &&
        (/\.(cmd|bat)$/i.test(config.command) || WIN_SHIM_RE.test(config.command));
    if (!needsShell) {
        return (0, child_process_1.spawn)(config.command, config.args || [], base);
    }
    // shell:true cu UN SINGUR string (fără array de args → fără DEP0190)
    const line = [config.command, ...(config.args || [])]
        .map(quoteForCmd)
        .join(' ');
    return (0, child_process_1.spawn)(line, { ...base, shell: true });
}
/** Omorâm agresiv un proces rămas (fallback după kill() grațios). */
function hardKill(pid) {
    if (!pid)
        return;
    try {
        if (process.platform === 'win32') {
            (0, child_process_1.spawn)('taskkill', ['/PID', String(pid), '/T', '/F'], {
                windowsHide: true,
                stdio: 'ignore'
            });
        }
        else {
            process.kill(pid, 'SIGKILL');
        }
    }
    catch {
        /* best-effort */
    }
}
// v2.5.23 (bug #54): bugetul comun de payload către AI (cap+coadă).
const TEXT_MAX = payload_1.MAX_CHARS_TOTAL;
/** Transformă rezultatul brut tools/call în text + flag de eroare. */
function formatToolCallResult(result) {
    const parts = [];
    const content = Array.isArray(result?.content) ? result.content : [];
    for (const c of content) {
        if (!c || typeof c !== 'object') {
            parts.push(String(c).slice(0, 4000));
            continue;
        }
        if (c.type === 'text' && typeof c.text === 'string') {
            parts.push(c.text);
        }
        else if (c.type === 'image') {
            parts.push('[image ' + (c.mimeType || '') + ' — cannot be displayed in chat]');
        }
        else if (c.type === 'resource') {
            const uri = c.resource?.uri ?? '';
            const text = typeof c.resource?.text === 'string' ? '\n' + c.resource.text : '';
            parts.push('[resource ' + uri + ']' + text);
        }
        else {
            parts.push(JSON.stringify(c).slice(0, 4000));
        }
    }
    if (!parts.length && result !== undefined) {
        try {
            parts.push(JSON.stringify(result, null, 2));
        }
        catch {
            parts.push(String(result));
        }
    }
    const text = (0, payload_1.clipPayload)(parts.join('\n\n'), TEXT_MAX);
    return { text, isError: result?.isError === true, raw: result };
}
/**
 * Normalizează configul brut (din `.vscode/mcp.json` sau din setări).
 * Acceptă `{ servers: {...} }` (VS Code) și `{ mcpServers: {...} }`
 * (Claude Desktop). Doar transportul stdio este suportat.
 */
function normalizeMcpConfig(raw) {
    const out = {};
    const servers = raw?.servers ?? raw?.mcpServers;
    if (!servers || typeof servers !== 'object')
        return out;
    for (const [name, cfg] of Object.entries(servers)) {
        if (!cfg || typeof cfg !== 'object')
            continue;
        const type = String(cfg.type ?? 'stdio').toLowerCase();
        if (type && type !== 'stdio') {
            log('skip server ' + name + ': transport "' + type + '" (doar stdio)');
            continue;
        }
        const command = typeof cfg.command === 'string' ? cfg.command.trim() : '';
        if (!command) {
            log('skip server ' + name + ': lipsește "command"');
            continue;
        }
        const args = Array.isArray(cfg.args)
            ? cfg.args.filter((a) => typeof a === 'string')
            : undefined;
        let env;
        if (cfg.env && typeof cfg.env === 'object') {
            env = {};
            for (const [k, v] of Object.entries(cfg.env))
                env[k] = String(v);
        }
        out[name] = {
            command,
            args,
            env,
            cwd: typeof cfg.cwd === 'string' && cfg.cwd ? cfg.cwd : undefined,
            disabled: cfg.disabled === true
        };
    }
    return out;
}
class McpClient {
    processes = new Map();
    buffers = new Map();
    stderrTail = new Map();
    stopping = new Set();
    nextId = 1;
    pending = new Map();
    tools = [];
    configs = {};
    states = new Map();
    opts;
    /** Notificare de eroare la pornire (folosită de manager pentru UI). */
    onServerError;
    /** Un proces de server s-a terminat singur (crash) în timp ce rula. */
    onServerExit;
    /** Lista de unelte s-a schimbat (start/stop/restart). */
    onToolsChanged;
    constructor(opts) {
        this.opts = {
            requestTimeoutMs: Math.max(1000, opts?.requestTimeoutMs ?? 60000),
            initializeTimeoutMs: Math.max(1000, opts?.initializeTimeoutMs ?? 120000),
            toolTimeoutMs: Math.max(1000, opts?.toolTimeoutMs ?? 60000)
        };
    }
    setToolTimeoutMs(ms) {
        if (Number.isFinite(ms)) {
            this.opts.toolTimeoutMs = Math.min(600000, Math.max(1000, ms));
        }
    }
    async loadConfig() {
        let mcpConfig = {};
        try {
            // require lazy — în teste Node modulul 'vscode' poate lipsi
            const v = require('vscode');
            // 1. .vscode/mcp.json din workspace
            const workspaceFolder = v.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const configPath = v.Uri.joinPath(workspaceFolder.uri, '.vscode', 'mcp.json');
                try {
                    const content = await v.workspace.fs.readFile(configPath);
                    mcpConfig = JSON.parse(Buffer.from(content).toString('utf8'));
                    log('loaded .vscode/mcp.json');
                }
                catch {
                    /* fișierul nu există sau nu e JSON valid */
                }
            }
            // 2. Fallback: settings.json
            if (!mcpConfig ||
                typeof mcpConfig !== 'object' ||
                Object.keys(mcpConfig).length === 0) {
                const settingsConfig = v.workspace
                    .getConfiguration('freekit')
                    .get('mcpServers', {}) || {};
                mcpConfig = { servers: settingsConfig };
                log('loaded settings freekit.mcpServers');
            }
        }
        catch {
            /* fără vscode (teste Node) — rămâne configul injectat manual */
        }
        this.configs = normalizeMcpConfig(mcpConfig);
        log('found ' + Object.keys(this.configs).length + ' MCP servers');
    }
    /** Injectare directă de config (teste / reload programatic). */
    setConfigs(configs) {
        this.configs = { ...configs };
    }
    getConfigs() {
        return { ...this.configs };
    }
    serverNames() {
        return Object.keys(this.configs);
    }
    getServerInfos() {
        return Array.from(this.states.values()).map((s) => ({ ...s }));
    }
    getServerInfo(name) {
        const s = this.states.get(name);
        return s ? { ...s } : undefined;
    }
    async startAll() {
        for (const [name, config] of Object.entries(this.configs)) {
            if (config.disabled) {
                log('server ' + name + ' dezactivat — sar peste');
                continue;
            }
            try {
                await this.startServer(name, config);
            }
            catch (e) {
                const message = e?.message ?? String(e);
                log('server ' + name + ' failed: ' + message);
                this.onServerError?.(name, message);
                try {
                    const v = require('vscode');
                    void v.window.showWarningMessage('MCP server "' + name + '" failed to start: ' + message);
                }
                catch {
                    /* fără vscode (teste) */
                }
            }
        }
    }
    async startServer(name, config) {
        if (this.processes.has(name)) {
            await this.stopServer(name);
        }
        const commandLine = config.command + (config.args?.length ? ' ' + config.args.join(' ') : '');
        const info = {
            name,
            state: 'starting',
            tools: 0,
            command: commandLine
        };
        this.states.set(name, info);
        log('starting server: ' + name + ' → ' + commandLine);
        let proc;
        try {
            proc = spawnServer(config);
        }
        catch (e) {
            const message = e?.message ?? String(e);
            this.states.set(name, { ...info, state: 'failed', error: message });
            throw new Error(message);
        }
        this.processes.set(name, proc);
        this.buffers.set(name, '');
        this.stderrTail.set(name, '');
        proc.stdout?.on('data', (chunk) => {
            this.handleData(name, chunk.toString());
        });
        proc.stderr?.on('data', (chunk) => {
            const tail = ((this.stderrTail.get(name) ?? '') + chunk.toString()).slice(-2000);
            this.stderrTail.set(name, tail);
            log('[' + name + ' stderr] ' + chunk.toString().slice(0, 200).trim());
        });
        proc.on('error', (err) => {
            log('server ' + name + ' spawn error: ' + err.message);
            this.states.set(name, {
                ...(this.states.get(name) ?? info),
                state: 'failed',
                error: 'spawn: ' + err.message
            });
        });
        proc.on('exit', (code, signal) => {
            log('server ' + name + ' exited with code ' + code + ' (signal ' + signal + ')');
            if (this.processes.get(name) === proc) {
                this.processes.delete(name);
            }
            // respinge request-urile rămase în așteptare pentru acest server
            for (const [id, p] of Array.from(this.pending.entries())) {
                if (p.serverName === name) {
                    clearTimeout(p.timer);
                    this.pending.delete(id);
                    p.reject(new Error('MCP server ' + name + ' closed (code ' + code + ')'));
                }
            }
            if (this.stopping.has(name))
                return; // oprire intenționată
            const st = this.states.get(name);
            if (st && (st.state === 'running' || st.state === 'starting')) {
                const tail = this.stderrTail.get(name)?.trim() ?? '';
                this.states.set(name, {
                    ...st,
                    state: 'failed',
                    error: 'proces terminat (code ' + code + ')' +
                        (tail ? ' — ' + tail.split('\n').pop() : '')
                });
                this.onServerExit?.(name, code);
            }
        });
        // așteaptă spawn-ul: un command inexistent eșuează IMEDIAT (nu după
        // timeout-ul de initialize)
        try {
            await new Promise((resolve, reject) => {
                const onSpawn = () => {
                    cleanup();
                    resolve();
                };
                const onErr = (err) => {
                    cleanup();
                    reject(new Error('spawn: ' + err.message));
                };
                const cleanup = () => {
                    proc.removeListener('spawn', onSpawn);
                    proc.removeListener('error', onErr);
                };
                proc.once('spawn', onSpawn);
                proc.once('error', onErr);
            });
        }
        catch (e) {
            const message = e?.message ?? String(e);
            this.processes.delete(name);
            this.states.set(name, { ...info, state: 'failed', error: message });
            throw new Error(message);
        }
        // --- handshake MCP: initialize → notifications/initialized → tools/list
        try {
            const initRes = await this.sendRequest(name, 'initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'freekit', version: '1.1.0' }
            }, this.opts.initializeTimeoutMs);
            this.sendNotification(name, 'notifications/initialized');
            // descoperă uneltele (tools/list acceptă paginare prin cursor)
            this.tools = this.tools.filter((t) => t.serverName !== name);
            let cursor;
            for (let page = 0; page < 50; page++) {
                const result = await this.sendRequest(name, 'tools/list', cursor ? { cursor } : {}, this.opts.requestTimeoutMs);
                const tools = Array.isArray(result?.tools) ? result.tools : [];
                for (const tool of tools) {
                    if (tool && typeof tool.name === 'string') {
                        this.tools.push({
                            name: tool.name,
                            description: typeof tool.description === 'string'
                                ? tool.description
                                : undefined,
                            inputSchema: tool.inputSchema,
                            serverName: name
                        });
                    }
                }
                cursor =
                    typeof result?.nextCursor === 'string' && result.nextCursor
                        ? result.nextCursor
                        : undefined;
                if (!cursor)
                    break;
            }
            const count = this.tools.filter((t) => t.serverName === name).length;
            this.states.set(name, {
                ...info,
                state: 'running',
                tools: count,
                serverVersion: typeof initRes?.serverInfo?.version === 'string'
                    ? initRes.serverInfo.version
                    : undefined
            });
            log('server ' + name + ' exposes ' + count + ' tools');
            this.onToolsChanged?.();
        }
        catch (e) {
            // pornirea a eșuat — nu lăsăm procesul orfan
            await this.stopServer(name);
            const message = e?.message ?? String(e);
            this.states.set(name, { ...info, state: 'failed', error: message });
            throw new Error('MCP server "' + name + '": ' + message);
        }
    }
    async restartServer(name) {
        const cfg = this.configs[name];
        if (!cfg)
            throw new Error('Server necunoscut: ' + name);
        await this.stopServer(name);
        await this.startServer(name, cfg);
    }
    writeRaw(serverName, obj) {
        const proc = this.processes.get(serverName);
        if (!proc || !proc.stdin || proc.stdin.destroyed)
            return;
        try {
            proc.stdin.write(JSON.stringify(obj) + '\n');
        }
        catch {
            /* pipe închis */
        }
    }
    handleData(serverName, chunk) {
        const buf = (this.buffers.get(serverName) ?? '') + chunk;
        const lines = buf.split('\n');
        this.buffers.set(serverName, lines.pop() ?? '');
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line[0] !== '{')
                continue; // banner/linii non-JSON
            let msg;
            try {
                msg = JSON.parse(line);
            }
            catch (e) {
                log('parse error from ' + serverName + ': ' + e.message);
                continue;
            }
            // răspuns la un request al nostru
            if (msg && msg.id !== undefined && !msg.method) {
                const pending = this.pending.get(msg.id);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pending.delete(msg.id);
                    if (msg.error) {
                        pending.reject(new Error('[MCP ' +
                            serverName +
                            '] ' +
                            (msg.error.message || 'error') +
                            (msg.error.code !== undefined
                                ? ' (code ' + msg.error.code + ')'
                                : '')));
                    }
                    else {
                        pending.resolve(msg.result);
                    }
                }
                continue;
            }
            // request de la server (sampling/roots/elicitation) — nu suportăm încă;
            // răspundem cu eroare ca serverul să nu aștepte la infinit
            if (msg && msg.method && msg.id !== undefined) {
                this.writeRaw(serverName, {
                    jsonrpc: '2.0',
                    id: msg.id,
                    error: {
                        code: -32601,
                        message: 'Not supported by freekit: ' + msg.method
                    }
                });
                continue;
            }
            // notificare de la server (log etc.)
            if (msg && msg.method) {
                log('[' + serverName + '] ' + msg.method);
            }
        }
    }
    sendRequest(serverName, method, params, timeoutMs) {
        return new Promise((resolve, reject) => {
            const proc = this.processes.get(serverName);
            if (!proc || !proc.stdin || proc.stdin.destroyed) {
                reject(new Error('MCP server ' + serverName + ' is not running'));
                return;
            }
            const id = this.nextId++;
            const req = { jsonrpc: '2.0', id, method, params };
            const t = Math.max(1000, timeoutMs ?? this.opts.requestTimeoutMs);
            const timer = setTimeout(() => {
                if (this.pending.delete(id)) {
                    reject(new Error('Request timeout: ' + method + ' (' + serverName + ', ' +
                        Math.round(t / 1000) + 's)'));
                }
            }, t);
            if (typeof timer.unref === 'function')
                timer.unref();
            this.pending.set(id, { resolve, reject, serverName, timer });
            try {
                proc.stdin.write(JSON.stringify(req) + '\n');
            }
            catch (e) {
                const p = this.pending.get(id);
                if (p) {
                    clearTimeout(p.timer);
                    this.pending.delete(id);
                }
                reject(e);
            }
        });
    }
    sendNotification(serverName, method, params) {
        const proc = this.processes.get(serverName);
        if (!proc || !proc.stdin || proc.stdin.destroyed)
            return;
        try {
            proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
        }
        catch {
            /* pipe închis */
        }
    }
    getTools() {
        return this.tools.map((t) => ({ ...t }));
    }
    async callTool(call) {
        const res = await this.callToolDetailed(call);
        return res.text;
    }
    async callToolDetailed(call) {
        log('calling tool ' + call.serverName + '/' + call.toolName);
        const result = await this.sendRequest(call.serverName, 'tools/call', { name: call.toolName, arguments: call.args ?? {} }, this.opts.toolTimeoutMs);
        return formatToolCallResult(result);
    }
    async stopServer(name) {
        const proc = this.processes.get(name);
        this.processes.delete(name);
        this.buffers.delete(name);
        this.stopping.add(name);
        // respinge request-urile în așteptare ale acestui server
        for (const [id, p] of Array.from(this.pending.entries())) {
            if (p.serverName === name) {
                clearTimeout(p.timer);
                this.pending.delete(id);
                p.reject(new Error('MCP server ' + name + ' was stopped'));
            }
        }
        if (proc) {
            log('stopping server: ' + name);
            const exited = new Promise((resolve) => {
                if (proc.exitCode !== null || proc.signalCode !== null) {
                    resolve();
                    return;
                }
                proc.once('exit', () => resolve());
            });
            try {
                proc.kill();
            }
            catch {
                /* deja terminat */
            }
            const hard = setTimeout(() => hardKill(proc.pid), 1500);
            await Promise.race([exited, sleep(3000)]);
            clearTimeout(hard);
        }
        this.stopping.delete(name);
        const st = this.states.get(name);
        if (st) {
            this.states.set(name, { ...st, state: 'stopped', tools: 0 });
        }
        else if (this.configs[name]) {
            this.states.set(name, {
                name,
                state: 'stopped',
                tools: 0,
                command: this.configs[name].command
            });
        }
        this.tools = this.tools.filter((t) => t.serverName !== name);
        this.onToolsChanged?.();
    }
    async stopAll() {
        for (const name of Array.from(this.processes.keys())) {
            await this.stopServer(name);
        }
        for (const name of Object.keys(this.configs)) {
            const st = this.states.get(name);
            if (st && st.state === 'running') {
                this.states.set(name, { ...st, state: 'stopped', tools: 0 });
            }
        }
        this.tools = [];
    }
}
exports.McpClient = McpClient;
//# sourceMappingURL=client.js.map