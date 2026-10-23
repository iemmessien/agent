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
exports.runDiagnostics = runDiagnostics;
const vscode = __importStar(require("vscode"));
const browser_1 = require("./browser");
const selectors_1 = require("./selectors");
const log_1 = require("./log");
const ollama_1 = require("./providers/ollama");
const manager_1 = require("./mcp/manager");
const voiceRecorder_1 = require("./voiceRecorder");
/* =========================================================================
 * v0.3.0 (P0.5) — comanda "Freekit: Diagnostics"
 * Verifică: browser detectat, port CDP, profil, Ollama, selectori reparați,
 * workspace trust. Scrie totul în canalul de log "Freekit".
 * ========================================================================= */
async function fetchJson(url, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok)
            return null;
        return await res.json();
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(t);
    }
}
async function runDiagnostics(browser, ctx) {
    const channel = (0, log_1.initLogChannel)();
    const opts = browser.options();
    const lines = [];
    lines.push('===== Freekit Diagnostics — ' + new Date().toLocaleString() + ' =====');
    lines.push('Extension: ' +
        ctx.extension.packageJSON.version +
        ' | VS Code: ' +
        vscode.version +
        ' | ' +
        process.platform +
        ' ' +
        process.arch +
        ' | Node ' +
        process.version);
    lines.push('Workspace trust: ' +
        (vscode.workspace.isTrusted
            ? 'TRUSTED'
            : 'RESTRICTED (read-only: file writes, commands and MCP tools are disabled)') +
        ' | folder: ' +
        (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '(none open)'));
    const chrome = await (0, browser_1.detectBrowserPath)(opts.chromePath);
    lines.push('Chrome/Edge: ' +
        (chrome ??
            'NOT FOUND — install Chrome or Edge, or set freekit.chromePath'));
    const running = await browser.isRunning();
    const version = running ? await browser.chromeVersion() : null;
    lines.push('CDP: port ' +
        opts.port +
        (running
            ? ' — responds (' + (version ?? 'unknown version') + ')'
            : ' — not responding (the browser is not running now)'));
    lines.push('Profil Chrome: ' + opts.profileDir);
    const ollamaUrl = (0, ollama_1.ollamaBaseUrl)();
    const ollama = await fetchJson(ollamaUrl + '/api/tags', 2500);
    if (ollama) {
        const models = Array.isArray(ollama.models)
            ? ollama.models.map((m) => m?.name).filter(Boolean)
            : [];
        lines.push('Ollama: OK — models: ' + (models.join(', ') || '(none)'));
    }
    else {
        lines.push('Ollama: not responding at ' + ollamaUrl + ' (optional — local mode only)');
    }
    const selInfo = selectors_1.selectors.info();
    lines.push('Active selectors: v' +
        selInfo.version +
        ' — source: ' +
        selInfo.source +
        (selInfo.remoteUrl
            ? ' (' +
                selInfo.remoteUrl +
                (selInfo.remoteFetchedAt
                    ? ', downloaded at ' + new Date(selInfo.remoteFetchedAt).toLocaleString()
                    : '') +
                ')'
            : '') +
        ' | bundled: v' +
        selInfo.bundledVersion);
    const learned = selectors_1.selectors.listLearned();
    lines.push('Auto-repaired selectors (overrides): ' + learned.length);
    for (const l of learned) {
        // v2.5.44 (bug #101): selecțiile scrise manual sunt marcate ca atare
        lines.push('  - ' + l.provider + '.' + l.slot + ' → ' + l.selector + (l.locked ? ' [user-locked]' : ''));
    }
    // v1.1.0: starea serverelor MCP (active, unelte expuse, erori de pornire)
    lines.push(...manager_1.mcp.statusLines());
    // v1.7.3: captarea audio pentru voice input (rulează în Extension Host)
    lines.push('Voice input (captare): ' + (await (0, voiceRecorder_1.voiceBackendInfo)()));
    for (const line of lines)
        (0, log_1.logLine)('diagnostics', line);
    channel.show();
    vscode.window.showInformationMessage('Freekit: diagnostics were written to Output → Freekit.');
}
//# sourceMappingURL=diagnostics.js.map