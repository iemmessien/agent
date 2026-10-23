"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_FINDER_MODEL_AUTO = exports.AI_FINDER_PREFERRED_MODEL = void 0;
exports.isAutoAiFinderModel = isAutoAiFinderModel;
exports.chatCapableModels = chatCapableModels;
exports.pickAiFinderModel = pickAiFinderModel;
/**
 * v2.5.40 (bug #93) — alegerea modelului Ollama pentru AI selector finder.
 *
 * Înainte, finder-ul folosea orbire `freekit.ollamaModel`: dacă acolo era un
 * model neinstalat (ex. `gemma3:12b`), analiza nu mai pornea deloc, deși pe
 * mașină existau modele perfect utilizabile (`qwen2.5-coder:7b`), iar
 * utilizatorul rămânea să scoată selectorii manual din DevTools.
 *
 * Modul pur Node (fără `vscode`), ca politica de selecție să poată fi testată
 * izolat. Când `freekit.aiFinderModel` e `auto`, preferăm `gemma3:12b` și, dacă
 * nu e instalat, primul model de chat după preferință:
 * qwen2.5-coder > qwen-coder > qwen > llama > mistral > orice alt model.
 * Modelele de embeddings sunt excluse — nu pot analiza un DOM.
 */
const hardware_1 = require("./hardware");
/** Modelul preferat când setarea e `auto` (folosit dacă e instalat). */
exports.AI_FINDER_PREFERRED_MODEL = 'gemma3:12b';
/** Valoarea `auto` a setării `freekit.aiFinderModel`. */
exports.AI_FINDER_MODEL_AUTO = 'auto';
/** Ordinea de preferință (regex pe numele complet, case-insensitive). */
const AI_FINDER_MODEL_TIERS = [
    /^qwen2\.5-coder/,
    /^qwen-coder/,
    /^qwen/,
    /^llama/,
    /^mistral/
];
/** `true` dacă setarea cere alegerea automată (goală sau `auto`). */
function isAutoAiFinderModel(setting) {
    const v = String(setting ?? '')
        .trim()
        .toLowerCase();
    return !v || v === exports.AI_FINDER_MODEL_AUTO;
}
/** Doar modelele de chat (embeddings excluse), în ordinea primită. */
function chatCapableModels(installed) {
    return (installed || [])
        .map((m) => String(m ?? '').trim())
        .filter((m) => !!m && !(0, hardware_1.isEmbeddingModel)(m));
}
/** Dimensiunea (B) din tag: `qwen2.5-coder:7b` → 7; 0 = necunoscută. */
function paramsB(name) {
    const m = /:(\d+(?:\.\d+)?)b(?:$|[-.])/i.exec(name);
    return m ? Number(m[1]) : 0;
}
/**
 * Cel mai mic model din listă — analiza de DOM are un timeout de 30 s per
 * încercare (freekit.aiFinderTimeoutSeconds), deci un model mic e alegerea sigură când
 * tier-ul conține mai multe variante de mărimi. Numele fără tag (`:…b`) trece
 * ultimul, dar rămâne candidat.
 */
function smallest(models) {
    return [...models].sort((a, b) => {
        const da = paramsB(a) || Number.POSITIVE_INFINITY;
        const db = paramsB(b) || Number.POSITIVE_INFINITY;
        return da - db || a.localeCompare(b);
    })[0];
}
/**
 * Alege modelul pentru AI finder dintr-o listă de modele instalate.
 * `null` = niciun model de chat disponibil (listă goală sau doar embeddings).
 */
function pickAiFinderModel(installed) {
    const models = chatCapableModels(installed);
    if (!models.length)
        return null;
    const preferred = models.find((m) => m.toLowerCase().startsWith(exports.AI_FINDER_PREFERRED_MODEL));
    if (preferred) {
        return { model: preferred, reason: 'auto, ' + exports.AI_FINDER_PREFERRED_MODEL + ' available' };
    }
    const unavailable = 'auto, ' + exports.AI_FINDER_PREFERRED_MODEL + ' not available';
    for (const tier of AI_FINDER_MODEL_TIERS) {
        const matches = models.filter((m) => tier.test(m.toLowerCase()));
        if (matches.length)
            return { model: smallest(matches), reason: unavailable };
    }
    return { model: smallest(models), reason: unavailable };
}
//# sourceMappingURL=aiFinderModel.js.map