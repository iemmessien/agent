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
exports.UNHEALTHY_TTL_MS = exports.PROVIDER_SWITCH_ORDER = void 0;
exports.providerHealthFile = providerHealthFile;
exports.readProviderHealth = readProviderHealth;
exports.recordProviderMalformed = recordProviderMalformed;
exports.recordProviderSuccess = recordProviderSuccess;
exports.recordProviderNoResponse = recordProviderNoResponse;
exports.isProviderUnhealthy = isProviderUnhealthy;
exports.clearProviderUnhealthy = clearProviderUnhealthy;
exports.malformedRate = malformedRate;
exports.nextProviderInOrder = nextProviderInOrder;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const log_1 = require("./log");
/* =========================================================================
 * v2.5.56 (FIX 3/4) — FIABILITATEA PROVIDERILOR
 *
 * Fiecare răspuns care epuizează reluările de „malformed tool call" este un
 * eșec de protocol al providerului respectiv; fiecare mesaj încheiat cu un
 * răspuns final e un succes. Statisticile se persistă în globalStorage
 * (provider-reliability.json):
 *   { "deepseek": { "malformed": 15, "success": 42 } }
 *
 * La un task nou, o rată de eșec peste 20% declanșează o sugestie de switch;
 * la 3 eșecuri consecutive pe ACELAȘI mesaj, chatView trece automat pe
 * următorul provider din `PROVIDER_SWITCH_ORDER`.
 * ========================================================================= */
/**
 * v2.5.56 (FIX 3): ordinea în care se încearcă ceilalți provideri când unul
 * eșuează repetat — chatgpt > claude > qwen > gemini > mistral > deepseek.
 * Ollama nu intră în lanț (model local, fără chat web).
 */
exports.PROVIDER_SWITCH_ORDER = [
    'chatgpt',
    'claude',
    'qwen',
    'gemini',
    'mistral',
    'deepseek'
];
/** v2.5.74 (FIX 5): cât timp un provider rămâne marcat „unhealthy". */
exports.UNHEALTHY_TTL_MS = 30 * 60 * 1000;
const FILE_NAME = 'provider-reliability.json';
/** Calea fișierului de statistici din globalStorage. */
function providerHealthFile(root) {
    return path.join(root, FILE_NAME);
}
/** Citește statisticile (best-effort: fișier lipsă/corupt ⇒ obiect gol). */
function readProviderHealth(root) {
    try {
        if (!root)
            return {};
        const parsed = JSON.parse(fs.readFileSync(providerHealthFile(root), 'utf8'));
        const map = {};
        for (const [name, raw] of Object.entries(parsed ?? {})) {
            const malformed = Math.floor(Number(raw?.malformed));
            const success = Math.floor(Number(raw?.success));
            if (!Number.isFinite(malformed) && !Number.isFinite(success))
                continue;
            // v2.5.74 (FIX 5): câmpurile de „mut" sunt opționale (fișiere vechi)
            const noResponse = Math.floor(Number(raw?.noResponse));
            const unhealthyAt = Math.floor(Number(raw?.unhealthyAt));
            map[name] = {
                malformed: Number.isFinite(malformed) && malformed > 0 ? malformed : 0,
                success: Number.isFinite(success) && success > 0 ? success : 0,
                noResponse: Number.isFinite(noResponse) && noResponse > 0 ? noResponse : 0,
                unhealthyAt: Number.isFinite(unhealthyAt) && unhealthyAt > 0 ? unhealthyAt : 0
            };
        }
        return map;
    }
    catch {
        return {};
    }
}
function writeProviderHealth(root, map) {
    try {
        if (!root)
            return;
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(providerHealthFile(root), JSON.stringify(map, null, 2) + '\n', 'utf8');
    }
    catch (e) {
        (0, log_1.logLine)('provider-health', 'write failed: ' + (e?.message ?? String(e)));
    }
}
function bump(root, name, field) {
    if (!root || !name)
        return;
    const map = readProviderHealth(root);
    const entry = map[name] ?? { malformed: 0, success: 0 };
    entry[field] = (Number(entry[field]) || 0) + 1;
    map[name] = entry;
    writeProviderHealth(root, map);
}
/** Un mesaj al providerului a epuizat reluările de „malformed tool call". */
function recordProviderMalformed(root, name) {
    bump(root, name, 'malformed');
}
/** Un mesaj încheiat cu răspuns final (fără eșec de protocol). */
function recordProviderSuccess(root, name) {
    bump(root, name, 'success');
    // v2.5.74 (FIX 5): un răspuns reușit scoate providerul din starea „unhealthy"
    clearProviderUnhealthy(root, name);
}
/**
 * v2.5.74 (FIX 5): providerul a rămas MUT (input acceptat, dar niciun răspuns)
 * — intră în statistici ca „noResponse" și e marcat `unhealthy`, ca mesajele
 * următoare să nu-l mai aștepte degeaba. Log: `[provider-health] <name> marked
 * unhealthy …`.
 */
function recordProviderNoResponse(root, name) {
    if (!root || !name)
        return;
    const map = readProviderHealth(root);
    const entry = map[name] ?? { malformed: 0, success: 0 };
    entry.noResponse = (entry.noResponse ?? 0) + 1;
    entry.unhealthyAt = Date.now();
    map[name] = entry;
    writeProviderHealth(root, map);
    (0, log_1.logLine)('provider-health', name + ' marked unhealthy (no response ' + entry.noResponse + 'x)');
}
/** v2.5.74 (FIX 5): `true` dacă providerul e marcat „unhealthy" (recent). */
function isProviderUnhealthy(root, name, withinMs = exports.UNHEALTHY_TTL_MS) {
    const entry = readProviderHealth(root)[name];
    if (!entry?.unhealthyAt)
        return false;
    return Date.now() - entry.unhealthyAt < withinMs;
}
/** v2.5.74 (FIX 5): scoate marcajul „unhealthy" (ex: după un răspuns reușit). */
function clearProviderUnhealthy(root, name) {
    if (!root || !name)
        return;
    const map = readProviderHealth(root);
    const entry = map[name];
    if (!entry?.unhealthyAt)
        return;
    entry.unhealthyAt = 0;
    map[name] = entry;
    writeProviderHealth(root, map);
}
/** Rata de eșecuri malformed (0..1); 0 când încă nu există date. */
function malformedRate(entry) {
    const malformed = entry?.malformed ?? 0;
    const success = entry?.success ?? 0;
    const total = malformed + success;
    return total > 0 ? malformed / total : 0;
}
/** Următorul provider din ordinea de rezervă (ciclic). */
function nextProviderInOrder(name) {
    const idx = exports.PROVIDER_SWITCH_ORDER.indexOf(name);
    if (idx < 0)
        return exports.PROVIDER_SWITCH_ORDER[0];
    return exports.PROVIDER_SWITCH_ORDER[(idx + 1) % exports.PROVIDER_SWITCH_ORDER.length];
}
//# sourceMappingURL=providerHealth.js.map