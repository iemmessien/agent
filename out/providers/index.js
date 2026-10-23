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
exports.BROWSER_PROVIDER_IDS = exports.PROVIDER_LABELS = exports.PROVIDER_IDS = void 0;
exports.createProvider = createProvider;
exports.checkBrowserAvailable = checkBrowserAvailable;
exports.checkOllamaAvailable = checkOllamaAvailable;
exports.ollamaInstallState = ollamaInstallState;
exports.getProviderStatus = getProviderStatus;
const vscode = __importStar(require("vscode"));
const deepseek_1 = require("./deepseek");
const chatgpt_1 = require("./chatgpt");
const gemini_1 = require("./gemini");
const claude_1 = require("./claude");
const ollama_1 = require("./ollama");
const mistral_1 = require("./mistral");
const qwen_1 = require("./qwen");
exports.PROVIDER_IDS = [
    'auto',
    'deepseek',
    'chatgpt',
    'gemini',
    'claude',
    'mistral',
    'qwen',
    'ollama'
];
exports.PROVIDER_LABELS = {
    auto: 'Auto (Browser → Ollama)',
    deepseek: 'DeepSeek',
    chatgpt: 'ChatGPT',
    gemini: 'Gemini',
    claude: 'Claude',
    mistral: 'Mistral (Vibe)',
    qwen: 'Qwen',
    ollama: 'Ollama (local)'
};
/** Providerii web (prin Chrome/CDP) — folosiți și de lanțul Auto. */
exports.BROWSER_PROVIDER_IDS = [
    'deepseek',
    'chatgpt',
    'gemini',
    'claude',
    'mistral',
    'qwen'
];
/** Creează adaptorul pentru providerul dat (fallback: DeepSeek). */
function createProvider(id) {
    switch (id) {
        case 'chatgpt':
            return new chatgpt_1.ChatGPTProvider();
        case 'gemini':
            return new gemini_1.GeminiProvider();
        case 'claude':
            return new claude_1.ClaudeProvider();
        case 'mistral':
            return new mistral_1.MistralProvider();
        case 'qwen':
            return new qwen_1.QwenProvider();
        case 'ollama':
            return new ollama_1.OllamaProvider();
        default:
            return new deepseek_1.DeepSeekProvider();
    }
}
/* =========================================================================
 * v0.4.0 — verificări de disponibilitate + status combinat (folosite de
 * badge-ul din toolbar și de comanda "Show Provider Status").
 * ========================================================================= */
/** Verifică dacă portul CDP al Chrome răspunde (max 2s). */
async function checkBrowserAvailable(port) {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
            signal: AbortSignal.timeout(2000)
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
/** Verifică dacă Ollama răspunde (max 2s). */
async function checkOllamaAvailable(url) {
    try {
        const res = await fetch(`${url}/api/tags`, {
            signal: AbortSignal.timeout(2000)
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
function ollamaInstallState(info) {
    if (info.ollama)
        return 'running';
    return info.ollamaCli ? 'installed' : 'missing';
}
/** Starea tuturor providerilor: browser (CDP), logare DeepSeek, Ollama + modele. */
async function getProviderStatus() {
    const config = vscode.workspace.getConfiguration('freekit');
    const rawPort = Number(config.get('cdpPort', 9222));
    const port = Number.isFinite(rawPort) && rawPort >= 1024 && rawPort <= 65535
        ? Math.floor(rawPort)
        : 9222;
    const ollamaUrl = (0, ollama_1.ollamaBaseUrl)();
    const browser = await checkBrowserAvailable(port);
    const ollama = await checkOllamaAvailable(ollamaUrl);
    let deepseekLoggedIn = false;
    let ollamaModels = [];
    let ollamaModelDetails = [];
    if (browser) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json`);
            const tabs = (await res.json());
            deepseekLoggedIn = tabs.some((t) => t.url &&
                t.url.startsWith('https://chat.deepseek.com') &&
                !t.url.includes('sign_in'));
        }
        catch {
            /* ignoră */
        }
    }
    if (ollama) {
        ollamaModelDetails = await (0, ollama_1.listOllamaModelsDetailed)();
        ollamaModels = ollamaModelDetails.map((m) => m.name);
    }
    // v2.0.2: binarul poate exista chiar dacă serverul nu rulează (deci „Install"
    // nu mai are sens, dar „start ollama serve" da) — proba e cache-uită 60 s.
    const ollamaCli = await (0, ollama_1.detectOllamaCli)();
    return {
        browser,
        ollama,
        deepseekLoggedIn,
        ollamaModels,
        port,
        ollamaUrl,
        ollamaCli,
        ollamaModelDetails
    };
}
//# sourceMappingURL=index.js.map