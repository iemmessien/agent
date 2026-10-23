"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installMutationTracker = installMutationTracker;
exports.waitStep = waitStep;
exports.waitForAbort = waitForAbort;
const log_1 = require("./log");
const log = (msg) => (0, log_1.logLine)('mutation', msg);
/* =========================================================================
 * v0.8.0 — MUTATIONOBSERVER (final de generare detectat instant)
 *
 * Vechea așteptare verifica textul la fiecare 500ms (polling fix — consumă
 * CPU). Acum un MutationObserver rulează ÎN PAGINĂ și ține minte momentul
 * ultimei schimbări din DOM; "liniștea" (quietMs fără mutații) încheie pasul
 * de așteptare imediat. Cât timp stream-ul lucrează (mutații continue),
 * pasul e limitat la maxWaitMs, ca progresul, checkpoint-urile de reparare
 * a selectorilor și retrimiterea Enter să funcționeze neschimbate.
 * ========================================================================= */
/** Rulează ÎN PAGINĂ (serializat): instalează (o dată) tracker-ul de mutații. */
const installTrackerInPage = (reset) => {
    const w = window;
    let t = w.__freekitTracker;
    if (!t || !t.observer) {
        t = { lastMutation: Date.now() };
        try {
            const obs = new MutationObserver(() => {
                t.lastMutation = Date.now();
            });
            obs.observe(document.body || document.documentElement, {
                subtree: true,
                childList: true,
                characterData: true
            });
            t.observer = obs;
        }
        catch {
            /* fără MutationObserver rămâne doar fallback-ul pe timp */
        }
        w.__freekitTracker = t;
    }
    if (reset)
        t.lastMutation = Date.now();
    return !!t.observer;
};
/**
 * Instalează (idempotent) tracker-ul de mutații și resetează ceasul de
 * "liniște". Returnează false dacă pagina nu are MutationObserver sau
 * evaluarea a eșuat (atunci se folosește polling-ul clasic).
 */
async function installMutationTracker(page) {
    try {
        const ok = await page.evaluate(installTrackerInPage, true);
        log('tracker de mutații ' + (ok ? 'instalat (reset)' : 'indisponibil — fallback pe timp'));
        return ok;
    }
    catch (e) {
        log('installMutationTracker a eșuat: ' + (e?.message ?? String(e)));
        return false;
    }
}
/** Rulează ÎN PAGINĂ: pagina a fost liniștită `quietMs`? */
const waitQuietInPage = (quietMs) => {
    const t = window.__freekitTracker;
    return !!t && Date.now() - t.lastMutation >= quietMs;
};
/**
 * Un "pas" de așteptare înaintea fiecărei verificări:
 *   - 'quiet'   = pagina a fost liniștită quietMs (generarea probabil s-a terminat);
 *   - 'timeout' = încă se întâmplă mutații (stream activ) — verificăm oricum.
 * La anulare aruncă '__ABORTED__'.
 */
async function waitStep(page, opts = {}) {
    const quietMs = opts.quietMs ?? 900;
    const maxWaitMs = opts.maxWaitMs ?? 2500;
    const quiet = page
        .waitForFunction(waitQuietInPage, quietMs, { polling: 100, timeout: maxWaitMs })
        .then(() => 'quiet')
        .catch(() => 'timeout');
    if (!opts.abort)
        return quiet;
    const winner = await Promise.race([quiet, opts.abort]);
    if (winner === 'aborted')
        throw new Error('__ABORTED__');
    return winner;
}
/** Promisiune unică per trimitere: se rezolvă când `signal` este anulat. */
function waitForAbort(signal) {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve('aborted');
            return;
        }
        signal.addEventListener('abort', () => resolve('aborted'), { once: true });
    });
}
//# sourceMappingURL=mutation.js.map