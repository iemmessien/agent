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
exports.OllamaProvider = exports.OLLAMA_DOWNLOAD_URL = void 0;
exports.ollamaBaseUrl = ollamaBaseUrl;
exports.detectOllamaCli = detectOllamaCli;
exports.startOllamaServer = startOllamaServer;
exports.listOllamaModelsDetailed = listOllamaModelsDetailed;
exports.pullOllamaModel = pullOllamaModel;
const vscode = __importStar(require("vscode"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const log_1 = require("../log");
const providerErrors_1 = require("../providerErrors");
const log = (msg) => (0, log_1.logLine)('ollama', msg);
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/** v0.4.0: URL-ul de bază Ollama (setarea freekit.ollamaUrl; fără slash final). */
function ollamaBaseUrl() {
    const cfg = vscode.workspace.getConfiguration('freekit');
    const raw = String(cfg.get('ollamaUrl', '') || '').trim();
    return (raw || 'http://localhost:11434').replace(/\/+$/, '');
}
/** v2.0.2: pagina oficială de download (butonul „Install Ollama"). */
exports.OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';
/** v2.0.2: locurile în care se instalează Ollama dar care nu ajung în PATH. */
const OLLAMA_CLI_CANDIDATES = [
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
    path.join(os.homedir(), '.ollama', 'bin', 'ollama'),
    '/usr/local/bin/ollama',
    '/usr/bin/ollama',
    '/opt/homebrew/bin/ollama',
    '/Applications/Ollama.app/Contents/Resources/ollama'
];
/**
 * v2.0.2: există un binar `ollama` pe mașină?
 * Întâi îl rulează (`ollama --version`), apoi caută în PATH, apoi verifică
 * locațiile standard de instalare care nu sunt adăugate în PATH.
 * Rezultatul e ținut minte 60 s (statusul e reîmprospătat la fiecare 15 s).
 */
async function detectOllamaCli() {
    const now = Date.now();
    if (cliCache && (cliCache.value || now - cliCache.at < 60_000))
        return cliCache.value;
    const value = await probeOllamaCli();
    cliCache = { value, at: now };
    log('ollama CLI ' + (value ? 'detected' : 'not found'));
    return value;
}
let cliCache = null;
async function probeOllamaCli() {
    try {
        await execFileAsync('ollama', ['--version'], { timeout: 4000, windowsHide: true });
        return true;
    }
    catch (e) {
        // procesul a pornit dar a ieșit cu cod ≠ 0 → binarul există oricum
        if (e && typeof e.code === 'number')
            return true;
    }
    try {
        const finder = process.platform === 'win32' ? 'where' : 'which';
        await execFileAsync(finder, ['ollama'], { timeout: 4000, windowsHide: true });
        return true;
    }
    catch {
        /* nu e în PATH */
    }
    return OLLAMA_CLI_CANDIDATES.some((p) => {
        try {
            return fs.existsSync(p);
        }
        catch {
            return false;
        }
    });
}
/* =========================================================================
 * v2.5.31 (bug #73) — „fetch failed" mid-task (Ollama moare după ~9 min)
 * `fetch` către un server local care nu mai răspunde aruncă o eroare de
 * conexiune (undici: „TypeError: fetch failed" cu cause ECONNREFUSED). Fără
 * traducerea ei într-o eroare tipizată, chatView vedea o eroare generică și
 * bucla continua până la STOP manual: aici o transformăm în `provider_down`
 * (card cu „Restart Ollama") și oferim pornirea serverului dintr-un buton.
 * ========================================================================= */
/** v2.5.31 (bug #73): API-ul Ollama răspunde? (timeout scurt, fără cache). */
async function isOllamaReachable() {
    try {
        const res = await fetch(`${ollamaBaseUrl()}/api/tags`, {
            signal: AbortSignal.timeout(3000)
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
/** v2.5.31 (bug #73): calea binarului `ollama` (candidat standard sau PATH). */
async function resolveOllamaCliPath() {
    for (const p of OLLAMA_CLI_CANDIDATES) {
        try {
            if (fs.existsSync(p))
                return p;
        }
        catch {
            /* ignoră */
        }
    }
    try {
        const finder = process.platform === 'win32' ? 'where' : 'which';
        const r = await execFileAsync(finder, ['ollama'], {
            timeout: 4000,
            windowsHide: true
        });
        const first = String(r.stdout ?? '')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)[0];
        return first || 'ollama';
    }
    catch {
        return null;
    }
}
/**
 * v2.5.31 (bug #73): butonul „Restart Ollama" — pornește `ollama serve` în
 * fundal (detached) și așteaptă până când API-ul răspunde (max 15 s). Fail-open:
 * fără binar sau fără răspuns întoarce `ok: false` cu motivul, ca chatView să
 * îndrume utilizatorul (install / „ollama serve" manual).
 */
async function startOllamaServer() {
    if (await isOllamaReachable())
        return { ok: true };
    const bin = await resolveOllamaCliPath();
    if (!bin) {
        return { ok: false, error: 'the Ollama CLI was not found on this machine' };
    }
    try {
        const child = (0, child_process_1.spawn)(bin, ['serve'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        child.unref();
        log('started "ollama serve" (pid ' + (child.pid ?? '?') + ')');
    }
    catch (e) {
        return { ok: false, error: e?.message ?? String(e) };
    }
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        if (await isOllamaReachable()) {
            log('ollama is up at ' + ollamaBaseUrl());
            return { ok: true };
        }
    }
    return { ok: false, error: 'the server did not answer within 15s' };
}
/** v2.0.2: modelele instalate, cu dimensiune — afișate în meniul de model. */
async function listOllamaModelsDetailed() {
    try {
        const res = await fetch(`${ollamaBaseUrl()}/api/tags`, {
            signal: AbortSignal.timeout(3000)
        });
        const data = (await res.json());
        return (data.models || [])
            .map((m) => ({
            name: String(m?.name ?? ''),
            sizeBytes: Number(m?.size) || 0
        }))
            .filter((m) => !!m.name);
    }
    catch {
        return [];
    }
}
/**
 * v2.0.2: descarcă (`ollama pull`) un model, cu progres live.
 * Ollama răspunde cu NDJSON (`{"status":…,"completed":…,"total":…}`).
 */
async function pullOllamaModel(model, onProgress, signal) {
    const res = await fetch(`${ollamaBaseUrl()}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
        signal
    });
    if (!res.ok || !res.body) {
        let detail = '';
        try {
            const err = (await res.json());
            if (err?.error)
                detail = ' — ' + err.error;
        }
        catch {
            /* corp fără JSON */
        }
        throw new Error(`Ollama pull failed: ${res.status} ${res.statusText}${detail}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const handle = (line) => {
        const trimmed = line.trim();
        if (!trimmed)
            return;
        let evt;
        try {
            evt = JSON.parse(trimmed);
        }
        catch {
            return;
        }
        if (evt?.error)
            throw new Error(String(evt.error));
        const total = Number(evt?.total) || 0;
        const completed = Number(evt?.completed) || 0;
        onProgress?.({
            status: String(evt?.status ?? ''),
            percent: total > 0 ? Math.round((completed / total) * 100) : null
        });
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            handle(line);
        }
    }
    handle(buffer);
    log('pull finished: ' + model);
}
class OllamaProvider {
    name = 'ollama';
    /** v1.7.1: thinking-ul modelului (câmpul `thinking` din API) → callback chatView. */
    onThinking;
    /** v0.4.0: configurabil prin freekit.ollamaUrl (implicit localhost:11434). */
    get url() {
        return ollamaBaseUrl();
    }
    /** Marchează providerul ca local: fără Chrome/CDP, fără selectori. */
    local = true;
    history = [];
    /** v2.5.40 (bug #93): model explicit, dacă a fost cerut la construcție. */
    modelOverride;
    constructor(opts = {}) {
        this.modelOverride = String(opts.model ?? '').trim() || undefined;
    }
    /**
     * v2.5.11: modelul local configurat (freekit.ollamaModel).
     * v2.5.40 (bug #93): override-ul de la construcție are prioritate (folosit de
     * AI selector finder, care își rezolvă singur modelul — vezi
     * `resolveAiFinderModel`).
     */
    configuredModel() {
        if (this.modelOverride)
            return this.modelOverride;
        return vscode.workspace
            .getConfiguration('freekit')
            .get('ollamaModel', 'qwen2.5-coder:7b');
    }
    async open(_page) {
        // Verifică că Ollama rulează
        const ok = await this.isAvailable();
        if (!ok) {
            // v2.5.31 (bug #73): eroare tipizată → cardul cu „Restart Ollama"
            throw new providerErrors_1.DetectedProviderError('ollama', (0, providerErrors_1.providerDown)('ollama', 'no response', this.url));
        }
        const models = await this.listModels();
        log('Ollama available, models: ' + (models.join(', ') || '(none)'));
        // v2.5.11 (bug #24/#25): modelul configurat trebuie să existe local. Fără
        // verificarea asta, `send` lovea un 404 sec, afișat ca text brut în chat.
        // Lista e deja adusă aici, deci verificarea nu costă nimic în plus.
        const configured = this.configuredModel();
        if (!models.includes(configured)) {
            throw new providerErrors_1.DetectedProviderError('ollama', (0, providerErrors_1.ollamaModelMissing)(configured, models));
        }
    }
    async newChat(_page) {
        this.history = [];
        log('history reset');
    }
    async send(_page, message, signal, opts) {
        const model = this.configuredModel();
        // Local nu există „upload în chat": binarele/imaginite nu pot pleca.
        // Conținutul text al atașamentelor e deja inclus în `message`.
        if (opts?.files && opts.files.length) {
            opts.onNotice?.('⚠️ Ollama runs locally: binary files/images cannot be sent — ' +
                'only the text content of attachments reaches the model.');
        }
        log('send to ' + model + ', length=' + message.length);
        this.history.push({ role: 'user', content: message });
        let response;
        try {
            response = await fetch(`${this.url}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    messages: this.history,
                    stream: false,
                    options: {
                        temperature: 0.3,
                        num_ctx: 8192
                    }
                }),
                signal
            });
        }
        catch (e) {
            throw this.asProviderDown(e, signal);
        }
        if (!response.ok) {
            // Ollama pune detaliul în JSON (ex: model negăsit -> 404)
            let detail = '';
            let body = '';
            try {
                const err = (await response.json());
                if (err?.error) {
                    body = String(err.error);
                    detail = ' — ' + body;
                }
            }
            catch {
                /* corp fără JSON */
            }
            // v2.5.11 (bug #25): model lipsă → eroare tipizată, ca chatView să
            // afișeze cardul dedicat (buton „Download model"), nu textul brut de 404.
            const detected = (0, providerErrors_1.detectProviderError)(body, 'ollama');
            if (detected?.kind === 'model_missing' || response.status === 404) {
                const available = await this.listModels().catch(() => []);
                throw new providerErrors_1.DetectedProviderError('ollama', detected?.kind === 'model_missing' && detected.model
                    ? { ...detected, availableModels: available }
                    : (0, providerErrors_1.ollamaModelMissing)(this.configuredModel(), available));
            }
            throw new Error('Ollama error: ' + response.status + ' ' + response.statusText + detail);
        }
        let data;
        try {
            data = (await response.json());
        }
        catch (e) {
            // corp întrerupt la mijloc (serverul a murit) → tot eroare de conexiune
            throw this.asProviderDown(e, signal);
        }
        const reply = data.message?.content || '';
        // v1.7.1: thinking separat (modele R1 / Qwen3 / etc.) → callback chatView
        const thinking = data.message?.thinking ?? data.message?.reasoning_content;
        if (typeof thinking === 'string' && thinking.trim()) {
            try {
                this.onThinking?.(thinking);
            }
            catch {
                /* callback-ul nu trebuie să strice trimiterea */
            }
        }
        log('got reply, length=' + reply.length);
        this.history.push({ role: 'assistant', content: reply });
        return reply;
    }
    async isAvailable() {
        try {
            const res = await fetch(`${this.url}/api/tags`);
            return res.ok;
        }
        catch {
            return false;
        }
    }
    /**
     * v2.5.31 (bug #73): „fetch failed" / ECONNREFUSED → eroare tipizată
     * `provider_down` (chatView oprește bucla + card cu „Restart Ollama").
     * Anularea de către utilizator (Stop) rămâne eroarea originală.
     */
    asProviderDown(e, signal) {
        if (signal?.aborted)
            return e;
        if (!(0, providerErrors_1.isProviderConnectionError)(e))
            return e;
        const detail = String(e?.cause?.code ?? e?.message ?? 'fetch failed');
        log('connection error: ' + detail);
        return new providerErrors_1.DetectedProviderError('ollama', (0, providerErrors_1.providerDown)('ollama', detail, this.url));
    }
    async listModels() {
        try {
            const res = await fetch(`${this.url}/api/tags`, {
                // v2.5.11: același timeout ca `listOllamaModelsDetailed` — un server
                // care nu răspunde nu trebuie să blocheze fluxul de eroare.
                signal: AbortSignal.timeout(5000)
            });
            const data = (await res.json());
            return (data.models || []).map((m) => m.name);
        }
        catch {
            return [];
        }
    }
}
exports.OllamaProvider = OllamaProvider;
//# sourceMappingURL=ollama.js.map