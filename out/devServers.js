"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.STOP_KILL_MS = exports.SHELL_INTEGRATION_WAIT_MS = exports.DEFAULT_GRACE_MS = exports.LONG_RUNNING_PATTERNS = exports.LONG_RUNNING_SCRIPTS = void 0;
exports.isLongRunningScript = isLongRunningScript;
exports.isLongRunningCommand = isLongRunningCommand;
exports.getRunningDevServers = getRunningDevServers;
exports.findRunningDevServer = findRunningDevServer;
exports.devServerLabel = devServerLabel;
exports.startDevServer = startDevServer;
exports.stopDevServers = stopDevServers;
exports.formatDevServerStartResult = formatDevServerStartResult;
const path = __importStar(require("path"));
const log_1 = require("./log");
const payload_1 = require("./payload");
/* =========================================================================
 * v1.8.1 — COMENZI LONG-RUNNING (dev/serve/watch) → TERMINAL VS CODE VIZIBIL
 * Până acum `npm run dev` / `npm start` / `vite` / `nodemon` etc. porneau
 * DETAȘAT, în fundal: AI-ul nu se bloca, dar utilizatorul NU vedea nimic —
 * nici compile, nici erori, nici când serverul e gata.
 *
 * Acum fiecare comandă long-running pornește într-un TERMINAL VS Code
 * dedicat, VIZIBIL (panoul de jos):
 *   1. utilizatorul vede output-ul live (compile, warnings, erori);
 *   2. poate apăsa Ctrl+C în acel terminal să oprească serverul (normal);
 *   3. output-ul e capturat live — primele secunde (URL-ul + erorile rapide
 *      de pornire: port ocupat, syntax error) ajung la AI;
 *   4. serverul rămâne pornit după ce AI-ul termină; oprirea se face din
 *      terminal (Ctrl+C) sau cu comanda „Freekit: Stop Dev Servers”.
 *
 * CAPTURA folosește Shell Integration (API STABIL, VS Code ≥ 1.93):
 * `terminal.shellIntegration.executeCommand()` + `execution.read()`.
 * (`onDidWriteTerminalData` e încă un API PROPOSED — pentru extensiile
 * instalate din VSIX e filtrat la runtime și rămâne `undefined` dacă VS Code
 * nu e pornit cu `--enable-proposed-api`, deci nu poate susține captura.)
 * Fără shell integration comanda pornește la fel de vizibil (`sendText`), dar
 * fără captură — rezultatul îi spune explicit AI-ului acest lucru.
 * ========================================================================= */
exports.LONG_RUNNING_SCRIPTS = new Set([
    'dev', 'start', 'serve', 'watch', 'preview', 'storybook',
    'develop', 'nodemon', 'hot', 'live', 'start:dev', 'dev:server'
]);
exports.LONG_RUNNING_PATTERNS = [
    /\bdev\b/i,
    /\bserve\b/i,
    /\bstart\b/i,
    /\bwatch\b/i,
    /\bpreview\b/i
];
/** true dacă numele unui script (npm) e long-running: dev, start, serve, watch... */
function isLongRunningScript(script) {
    if (!script)
        return false;
    const normalized = script.toLowerCase().trim();
    if (exports.LONG_RUNNING_SCRIPTS.has(normalized))
        return true;
    return exports.LONG_RUNNING_PATTERNS.some((p) => p.test(normalized));
}
/* -------------------------------------------------------------------------
 * Detectare la nivel de COMANDĂ (pentru run_command): npm/pnpm/yarn/bun
 * [run] <script>, lanțuri (`cd app && npm run dev`), npx + binare cunoscute
 * de dev server (vite, nodemon, next, astro, ng, uvicorn, ...).
 * ------------------------------------------------------------------------- */
const ALWAYS_LONG_BINS = new Set([
    'nodemon', 'http-server', 'live-server', 'json-server',
    'webpack-dev-server', 'gunicorn', 'uvicorn', 'serve'
]);
const CONDITIONAL_LONG_BINS = new Set([
    'vite', 'next', 'astro', 'nuxt', 'ng', 'svelte-kit', 'parcel', 'expo',
    'gatsby', 'flask', 'hugo', 'mkdocs', 'storybook', 'electron', 'webpack',
    'wrangler', 'vite-node', 'tsc', 'sass', 'less'
]);
// binare care, fără subcomandă, PORNESC DIRECT un server (vite, parcel, ...)
const BARE_LONG_BINS = new Set([
    'vite', 'parcel', 'gatsby', 'expo', 'nuxt', 'electron', 'storybook'
]);
// subcomenzi care se termină singure (nu trebuie detașate)
const ONE_SHOT_SUBCOMMANDS = new Set([
    'build', 'export', 'generate', 'check', 'lint', 'test', 'inspect',
    'optimize', 'deploy', 'publish', 'create', 'init', 'add', 'version'
]);
const DEV_ARGS_RE = /(^|\s)(dev|serve|server|watch|preview|start|hot|live|runserver)(\s|$)/i;
function analyzeSegment(rawSegment) {
    const segment = rawSegment.trim();
    if (!segment)
        return false;
    const tokens = segment.split(/\s+/);
    // sărim peste wrapper-uri uzuale: sudo / npx / pnpx / bunx (+ flagurile lor)
    let i = 0;
    while (i < tokens.length) {
        const t = tokens[i].toLowerCase().replace(/\.(cmd|exe)$/, '');
        if (t === 'sudo' || t === 'npx' || t === 'pnpx' || t === 'bunx') {
            i++;
            continue;
        }
        break;
    }
    while (i < tokens.length && tokens[i].startsWith('-'))
        i++;
    if (i >= tokens.length)
        return false;
    const bin = tokens[i]
        .split(/[\\/]/)
        .pop()
        .toLowerCase()
        .replace(/\.(cmd|exe)$/, '');
    const rest = tokens.slice(i + 1);
    const restStr = rest.join(' ');
    // 1) npm / pnpm / yarn / bun [run] <script> — verificăm numele scriptului
    if (bin === 'npm' || bin === 'pnpm' || bin === 'yarn' || bin === 'bun') {
        const j = (rest[0] ?? '').toLowerCase() === 'run' ? 1 : 0;
        const script = (rest[j] ?? '').replace(/^["']+|["']+$/g, '');
        if (script && isLongRunningScript(script))
            return true;
        // mod continuu cerut prin flaguri: npm run build -- --watch
        return (/--watch\b/i.test(segment) ||
            exports.LONG_RUNNING_PATTERNS.some((p) => p.test(segment)));
    }
    // 2) binare cunoscute de servere de dezvoltare (vite, nodemon, next, ...)
    if (ALWAYS_LONG_BINS.has(bin))
        return true;
    if (CONDITIONAL_LONG_BINS.has(bin)) {
        const positionals = rest.filter((t) => !t.startsWith('-'));
        // flask run (inclusiv „flask --app x run”)
        if (bin === 'flask' && positionals.includes('run'))
            return true;
        if (positionals.some((t) => ONE_SHOT_SUBCOMMANDS.has(t.toLowerCase()))) {
            return false; // ex. vite build / next build / wrangler deploy
        }
        if (BARE_LONG_BINS.has(bin))
            return true; // ex. vite / vite --host
        return DEV_ARGS_RE.test(restStr) || /--watch\b/i.test(restStr);
    }
    // 3) cazuri speciale python: manage.py runserver
    if ((bin === 'python' || bin === 'python3' || bin === 'py') &&
        /\brunserver\b/i.test(restStr)) {
        return true;
    }
    return false;
}
/** true dacă o comandă shell (run_command) e long-running și trebuie detașată. */
function isLongRunningCommand(command) {
    const cmd = String(command ?? '').trim();
    if (!cmd)
        return false;
    // lanțuri: „cd app && npm run dev”, „npm install && npm run dev”, „a; b”
    const segments = cmd.split(/&&|\|\||;|\|/);
    return segments.some((s) => analyzeSegment(s));
}
let vscodeApi;
function getVscode() {
    if (!vscodeApi)
        vscodeApi = require('vscode');
    return vscodeApi;
}
/** Grația implicită: cât se așteaptă output-ul de pornire înainte de răspuns. */
exports.DEFAULT_GRACE_MS = 3000;
/** Cât se așteaptă (max) activarea shell integration în terminalul nou. */
exports.SHELL_INTEGRATION_WAIT_MS = 4000;
/** Ctrl+C la oprire → cât se așteaptă ieșirea grațioasă înainte de dispose. */
exports.STOP_KILL_MS = 2500;
const MAX_CAPTURE = 48 * 1024;
// v2.5.23 (bug #54): output-ul trimis AI-ului respectă bugetul comun de payload.
const MAX_RESULT_TEXT = payload_1.MAX_CHARS_TOTAL;
const registry = new Map();
/** Serverele (terminale) care încă rulează (în sesiunea curentă). */
function getRunningDevServers() {
    return [...registry.values()]
        .filter((e) => !e.exited && !e.closed)
        .map(({ pid, command, cwd, startedAt, terminalName }) => ({
        pid,
        command,
        cwd,
        startedAt,
        terminalName
    }));
}
/** Găsește un server care rulează deja pentru (command, cwd) — anti-dublare. */
function findRunningDevServer(command, cwd) {
    const cmd = String(command ?? '').trim().toLowerCase();
    const dir = String(cwd ?? '').toLowerCase();
    return getRunningDevServers().find((s) => s.command.trim().toLowerCase() === cmd &&
        (!dir || s.cwd.toLowerCase() === dir));
}
/** „npm run dev” → „dev”; „vite --host” → „vite”; „cd app && npm start” → „start”. */
function devServerLabel(command) {
    const seg = String(command ?? '')
        .split(/&&|\|\||;|\|/)
        .pop()
        .trim();
    const tokens = seg.split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length &&
        (tokens[i].startsWith('-') || /^(sudo|npx|pnpx|bunx)$/i.test(tokens[i]))) {
        i++;
    }
    const bin = (tokens[i] ?? 'dev')
        .split(/[\\/]/)
        .pop()
        .replace(/\.(cmd|exe)$/i, '');
    const rest = tokens.slice(i + 1).filter((t) => !t.startsWith('-'));
    if (/^(npm|pnpm|yarn|bun)$/i.test(bin)) {
        const j = (rest[0] ?? '').toLowerCase() === 'run' ? 1 : 0;
        const script = (rest[j] ?? '').replace(/^["']+|["']+$/g, '');
        if (script)
            return script;
    }
    return bin || 'dev';
}
/** Nume unic de terminal: „Freekit: dev”; la conflict → „(dir)” apoi „#n”. */
function uniqueTerminalName(label, cwd) {
    const base = 'Freekit: ' + label;
    const taken = new Set([...registry.values()].map((e) => e.terminalName));
    if (!taken.has(base))
        return base;
    const dir = path.basename(cwd || '') || 'dir';
    const withDir = base + ' (' + dir + ')';
    if (!taken.has(withDir))
        return withDir;
    for (let n = 2;; n++) {
        const numbered = base + ' #' + n;
        if (!taken.has(numbered))
            return numbered;
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Curăță secvențele ANSI (culori, titlu OSC, cursor) + \r din output. */
function stripAnsi(text) {
    return String(text)
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-9;?]*[0-9A-Za-z]/g, '')
        .replace(/\x1b[()][A-Z0-9]/g, '')
        .replace(/\r/g, '');
}
/** Linii aparent de eroare în primele secunde — doar semnal de avertizare. */
function looksLikeStartupError(text) {
    return /\b(error|EADDRINUSE|failed|not found|exception)\b/i.test(text);
}
function captureChunk(e, text) {
    if (e.output.length >= MAX_CAPTURE)
        return;
    e.output += text.slice(0, MAX_CAPTURE - e.output.length);
}
/** Așteaptă activarea Shell Integration în terminalul nou (sau timeout). */
function waitForShellIntegration(vsc, terminal, timeoutMs) {
    if (terminal.shellIntegration) {
        return Promise.resolve(terminal.shellIntegration);
    }
    const onDidChange = vsc.window.onDidChangeTerminalShellIntegration;
    if (typeof onDidChange !== 'function')
        return Promise.resolve(undefined);
    return new Promise((resolve) => {
        let done = false;
        const finish = (si) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            sub.dispose();
            resolve(si ?? terminal.shellIntegration);
        };
        const sub = onDidChange((e) => {
            if (e.terminal === terminal && e.shellIntegration) {
                finish(e.shellIntegration);
            }
        });
        const timer = setTimeout(() => finish(terminal.shellIntegration), timeoutMs);
    });
}
/** Scoate intrarea din registru + eliberează toți listener-ii ei. */
function removeEntry(e) {
    for (const d of e.subs.splice(0)) {
        try {
            d.dispose();
        }
        catch {
            /* ignore */
        }
    }
    if (registry.get(e.terminalName) === e)
        registry.delete(e.terminalName);
}
function clip(text, max = MAX_RESULT_TEXT) {
    // v2.5.23: cap+coadă (erorile de pornire pot fi la finalul blocului compilat)
    return (0, payload_1.clipPayload)(text, max);
}
function isLocalUrl(url) {
    const m = url.match(/^https?:\/\/([^/:?#]+)/i);
    if (!m)
        return false;
    const host = m[1].toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
        return true;
    }
    if (/^\[?::1?\]?$/.test(host))
        return true;
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host))
        return true;
    if (host.endsWith('.local') || host.endsWith('.localhost'))
        return true;
    return false;
}
function extractUrls(text) {
    const found = stripAnsi(text).match(/https?:\/\/[^\s"'`<>)\]}]+/gi) ?? [];
    const out = [];
    const seen = new Set();
    for (const raw of found) {
        const url = raw.replace(/[),.;:]+$/g, '');
        if (!isLocalUrl(url))
            continue;
        const key = url.replace(/\/+$/, '').toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(url);
        if (out.length >= 6)
            break;
    }
    return out;
}
/**
 * v1.8.1 — pornește comanda într-un TERMINAL VS Code dedicat, VIZIBIL:
 * - `terminal.show()` → utilizatorul vede output-ul live în panoul de jos;
 * - comanda rulează în shell-ul terminalului → Ctrl+C funcționează normal;
 * - output-ul e citit live prin Shell Integration și primele `graceMs`
 *   (implicit 3s) ajung în rezultat (URL + erori rapide de pornire);
 * - procesul rămâne pornit (nu e omorât la finalul buclei agentice).
 * Fără shell integration: comanda pornește la fel (sendText), dar fără
 * captură — rezultatul marchează explicit `captured: false`.
 */
async function startDevServer(command, opts = {}) {
    const started = Date.now();
    const graceMs = Number.isFinite(opts.graceMs) && opts.graceMs > 0
        ? Math.min(opts.graceMs, 60000)
        : exports.DEFAULT_GRACE_MS;
    const siWaitMs = Number.isFinite(opts.siWaitMs) && opts.siWaitMs >= 0
        ? Math.min(opts.siWaitMs, 60000)
        : exports.SHELL_INTEGRATION_WAIT_MS;
    const cwd = opts.cwd ?? process.cwd();
    const fail = (message, terminalName = '') => ({
        running: false,
        pid: null,
        stdout: '',
        stderr: '',
        output: message,
        exitCode: null,
        durationMs: Date.now() - started,
        urls: [],
        terminalName,
        captured: false,
        notes: []
    });
    let vsc;
    try {
        vsc = getVscode();
    }
    catch (e) {
        return fail('spawn error: VS Code API unavailable (' + (e?.message ?? String(e)) + ')');
    }
    const name = uniqueTerminalName(devServerLabel(command), cwd);
    let terminal;
    try {
        const options = { name, cwd, isTransient: false };
        const panel = vsc.TerminalLocation?.Panel;
        if (typeof panel === 'number')
            options.location = panel;
        terminal = vsc.window.createTerminal(options);
    }
    catch (e) {
        return fail('spawn error: ' + (e?.message ?? String(e)), name);
    }
    (0, log_1.logLine)('dev-server', 'starting in VS Code terminal "' + name + '": ' + command);
    let resolveEnded;
    const ended = new Promise((resolve) => {
        resolveEnded = resolve;
    });
    let endedDone = false;
    const markEnded = () => {
        if (endedDone)
            return;
        endedDone = true;
        resolveEnded();
    };
    const entry = {
        terminalName: name,
        terminal,
        command,
        cwd,
        startedAt: started,
        pid: null,
        exited: false,
        exitCode: null,
        closed: false,
        capture: false,
        output: '',
        ended,
        subs: []
    };
    registry.set(name, entry);
    // PID-ul shell-ului din terminal (best-effort, nu blochează pornirea)
    void Promise.resolve(terminal.processId)
        .then((p) => {
        if (typeof p === 'number' && p > 0)
            entry.pid = p;
    })
        .catch(() => {
        /* ignore */
    });
    // închiderea terminalului de către utilizator (X / dispose / kill)
    const onClose = vsc.window.onDidCloseTerminal;
    if (typeof onClose === 'function') {
        entry.subs.push(onClose((t) => {
            if (t !== terminal)
                return;
            entry.closed = true;
            removeEntry(entry);
            markEnded();
        }));
    }
    terminal.show(); // cerința principală: terminalul e VIZIBIL, în față
    // 1) captură live prin Shell Integration (API STABIL, VS Code ≥ 1.93)
    let execution;
    try {
        const si = await waitForShellIntegration(vsc, terminal, siWaitMs);
        if (si) {
            try {
                execution = si.executeCommand(command);
            }
            catch {
                execution = undefined;
            }
        }
    }
    catch {
        execution = undefined;
    }
    if (entry.closed) {
        removeEntry(entry);
        return fail('(terminal closed before the command was sent)', name);
    }
    if (execution) {
        entry.capture = true;
        // sfârșitul execuției → exit code + ieșirea din registru
        const onEnd = vsc.window.onDidEndTerminalShellExecution;
        if (typeof onEnd === 'function') {
            entry.subs.push(onEnd((e) => {
                if (e.terminal !== terminal)
                    return;
                if (execution && e.execution !== execution)
                    return;
                entry.exited = true;
                entry.exitCode = typeof e.exitCode === 'number' ? e.exitCode : null;
                removeEntry(entry);
                markEnded();
            }));
        }
        // citirea LIVE a output-ului: consumăm până la terminarea execuției
        // (altfel coada de output din VS Code crește nemărginit), dar păstrăm
        // doar MAX_CAPTURE în memorie
        void (async () => {
            try {
                for await (const chunk of execution.read()) {
                    captureChunk(entry, String(chunk));
                }
            }
            catch {
                /* stream închis */
            }
        })();
    }
    else {
        // fallback fără shell integration: la fel de vizibil, dar fără captură
        try {
            terminal.sendText(command);
        }
        catch (e) {
            removeEntry(entry);
            return fail('spawn error: ' + (e?.message ?? String(e)), name);
        }
    }
    // 2) perioada de grație: primele secunde de output (URL, erori rapide)
    const raced = await Promise.race([
        ended.then(() => 'ended'),
        sleep(graceMs).then(() => 'grace')
    ]);
    const captured = stripAnsi(entry.output);
    const urls = extractUrls(entry.output);
    const notes = [];
    if (raced === 'grace') {
        // procesul încă rulează (sau fallback-ul nu poate ști) — server pornit
        if (!entry.capture) {
            notes.push('live capture unavailable (shell integration did not activate in this terminal) — the full output is only visible in the terminal');
        }
        else if (looksLikeStartupError(captured)) {
            notes.push('the startup output contains apparent error lines — check the terminal to confirm the server actually started correctly');
        }
        return {
            running: true,
            pid: entry.pid,
            stdout: clip(captured),
            stderr: '',
            output: clip(captured),
            exitCode: null,
            durationMs: Date.now() - started,
            urls,
            terminalName: name,
            captured: entry.capture,
            notes
        };
    }
    // s-a terminat (crash / eroare de pornire) sau terminalul a fost închis
    const output = captured || (entry.closed ? '(terminal closed)' : '(no output)');
    notes.push('terminal „' + name + '” stays open — the full output is visible there');
    if (!entry.capture) {
        notes.push('live capture unavailable (shell integration) — see the terminal');
    }
    return {
        running: false,
        pid: entry.pid,
        stdout: clip(output),
        stderr: '',
        output: clip(output),
        exitCode: entry.exitCode,
        durationMs: Date.now() - started,
        urls,
        terminalName: name,
        captured: entry.capture,
        notes
    };
}
/** Oprește toate serverele pornite de extensie (comanda Stop Dev Servers). */
async function stopDevServers() {
    const report = { stopped: [], failed: [] };
    const entries = [...registry.values()].filter((e) => !e.exited && !e.closed);
    for (const e of entries) {
        const rest = {
            pid: e.pid,
            command: e.command,
            cwd: e.cwd,
            startedAt: e.startedAt,
            terminalName: e.terminalName
        };
        try {
            // 1) Ctrl+C grațios în terminalul serverului (ca un Ctrl+C normal al
            //    utilizatorului — framework-urile își fac cleanup-ul obișnuit)
            let ctrlCSent = true;
            try {
                e.terminal.sendText('\x03', false);
            }
            catch {
                ctrlCSent = false; // terminalul e deja mort/închis
            }
            if (ctrlCSent) {
                const exited = await Promise.race([
                    e.ended.then(() => true),
                    sleep(exports.STOP_KILL_MS).then(() => false)
                ]);
                if (!exited) {
                    // 2) nu a răspuns la Ctrl+C → închidem terminalul (VS Code omoară
                    //    procesul din el, împreună cu copiii lui)
                    try {
                        e.terminal.dispose();
                    }
                    catch {
                        /* ignore */
                    }
                }
            }
            else {
                try {
                    e.terminal.dispose();
                }
                catch {
                    /* ignore */
                }
            }
            removeEntry(e); // idempotent (end/close pot fi deja declanșate)
            report.stopped.push(rest);
            (0, log_1.logLine)('dev-server', 'stopped "' + e.terminalName + '": ' + e.command);
        }
        catch (err) {
            report.failed.push({
                pid: e.pid,
                command: e.command,
                terminalName: e.terminalName,
                error: err?.message ?? String(err)
            });
        }
    }
    return report;
}
/** Textul care ajunge la AI când un dev server a pornit în terminalul VS Code. */
function formatDevServerStartResult(toolLabel, command, res, opts = {}) {
    const lines = [];
    lines.push('✅ Server started in the VS Code TERMINAL „' +
        (res.terminalName || '?') +
        '” (visible in the VS Code bottom panel)');
    lines.push('tool: ' + toolLabel + ' — command: ' + command);
    if (opts.cwd)
        lines.push('directory: ' + opts.cwd);
    if (res.urls.length)
        lines.push('live URL: ' + res.urls.join(', '));
    for (const note of res.notes ?? [])
        lines.push('⚠️ ' + note);
    lines.push('The process runs in the DEDICATED VISIBLE TERMINAL (the user watches it there and can press Ctrl+C in it) and keeps running — do NOT wait for it and do NOT re-run this command.');
    const out = (res.output ?? '').trim();
    const graceSeconds = ((opts.graceMs ?? res.durationMs) / 1000).toFixed(1);
    if (out) {
        lines.push('--- output (first ' + graceSeconds + 's, captured live) ---');
        lines.push(out.slice(0, 6000));
        lines.push('--- end output ---');
    }
    else {
        lines.push('(no output yet in the first ' + graceSeconds + 's — normal for some servers)');
    }
    lines.push('Next: continue with your task or reply with the final answer. The user can stop the server with Ctrl+C in its terminal or with the VS Code command "Freekit: Stop Dev Servers".');
    return (0, payload_1.clipPayload)(lines.join('\n'), payload_1.MAX_CHARS_TOTAL);
}
//# sourceMappingURL=devServers.js.map