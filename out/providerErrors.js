"use strict";
/**
 * v2.5.1 — ERORI DE PROVIDER (detecție + mesaje clare).
 *
 * Când Claude/ChatGPT/DeepSeek/Gemini/Mistral returnează erori cunoscute („You
 * are out of free messages until 6:20 PM”, rate limit, CAPTCHA, sesiune
 * expirată), textul apare ca banner în pagină — NU în selectorii de răspuns.
 * Fără detecție, Freekit raporta „Timeout: no stable response … after 150s” și
 * utilizatorul credea că extensia e stricată.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DetectedProviderError = exports.PROVIDER_ERROR_CODE = void 0;
exports.ollamaModelMissing = ollamaModelMissing;
exports.providerDown = providerDown;
exports.isProviderConnectionError = isProviderConnectionError;
exports.isMemoryFullText = isMemoryFullText;
exports.isProviderPromoNoise = isProviderPromoNoise;
exports.limitSignalCount = limitSignalCount;
exports.confirmLimit = confirmLimit;
exports.isPlanLimitText = isPlanLimitText;
exports.upgradeUrlFor = upgradeUrlFor;
exports.detectProviderError = detectProviderError;
exports.providerErrorMessage = providerErrorMessage;
/** Codul purtat de eroarea aruncată către chatView (pentru afișare dedicată). */
exports.PROVIDER_ERROR_CODE = 'FREEKIT_PROVIDER_ERROR';
/** Etichete prietenoase pentru mesajul afișat utilizatorului. */
const PROVIDER_LABELS = {
    claude: 'Claude',
    chatgpt: 'ChatGPT',
    deepseek: 'DeepSeek',
    gemini: 'Gemini',
    mistral: 'Mistral',
    qwen: 'Qwen',
    /** v2.5.31 (bug #73): eticheta providerului local (cardul „stopped responding"). */
    ollama: 'Ollama'
};
/**
 * v2.5.11 (bug #24/#25): eroarea „model Ollama neinstalat", cu lista celor
 * instalate — folosită de `OllamaProvider` (validare în `open` + 404 în `send`).
 */
function ollamaModelMissing(model, available) {
    return {
        kind: 'model_missing',
        message: model
            ? 'Model "' + model + '" is not installed in Ollama.'
            : 'The configured Ollama model is not installed.',
        model: model || undefined,
        availableModels: available
    };
}
/**
 * v2.5.31 (bug #73): providerul a căzut în timpul sesiunii („fetch failed" /
 * ECONNREFUSED după ~9 minute de rulare). chatView oprește bucla agentică și
 * afișează cardul cu butoanele Restart / Switch provider / Retry.
 */
function providerDown(providerId, detail, url) {
    const label = PROVIDER_LABELS[providerId] || providerId || 'The provider';
    return {
        kind: 'provider_down',
        message: label +
            ' stopped responding' +
            (url ? ' at ' + url : '') +
            (detail ? ' (' + detail + ')' : '') +
            '.'
    };
}
/**
 * v2.5.31 (bug #73): eroarea vine din CONEXIUNE (serverul nu mai răspunde), nu
 * din protocol? Node/undici aruncă „TypeError: fetch failed" cu `cause` de tip
 * ECONNREFUSED / ECONNRESET / ENOTFOUND; alte medii raportează doar „fetch
 * error". Anularea de către utilizator (AbortError / abort pe signal) NU intră
 * aici — vezi apelantul, care verifică `signal.aborted` înainte.
 */
function isProviderConnectionError(err) {
    const e = err ?? {};
    if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR')
        return false;
    const parts = [
        typeof e?.message === 'string' ? e.message : '',
        typeof e?.cause?.message === 'string' ? e.cause.message : '',
        typeof e?.cause === 'string' ? e.cause : '',
        typeof e?.code === 'string' ? e.code : '',
        typeof e?.errno === 'string' ? e.errno : ''
    ].filter((p) => !!p);
    const text = parts.length ? parts.join(' | ') : String(err ?? '');
    return /fetch failed|fetch error|failed to fetch|econnrefused|econnreset|enotfound|etimedout|socket hang up|network error|other side closed|terminated/i.test(text);
}
/**
 * v2.5.15 (bug #41): textul afișat de ChatGPT când contextul chatului s-a
 * epuizat („Chat memory full — continue in a new chat", „memory limit
 * reached"). Folosit atât de detecția din `detectProviderError` (scanul de
 * pagină), cât și direct de `sendAndWait` pe textul citit din răspuns.
 */
function isMemoryFullText(text) {
    return /chat memory full|continue in a new chat|memory limit reached/i.test(String(text ?? ''));
}
/**
 * v2.5.43 (bug #100): fraze care semnalează o limită de plan/cotă. Regex fără
 * flag-ul `g`, ca `.test()` / `.match()` să nu depindă de `lastIndex`.
 */
const PLAN_LIMIT_RE = /free plan|quota exceeded|limit reached|you'?ve reached[^.\n]{0,60}|daily limit|message limit|try again later/i;
/**
 * v2.5.74 (FIX 3): textele de PROMO/CHROME care nu sunt niciodată o eroare de
 * provider. „Upgrade for more" (bannerul de upsell din sidebar) + „Dismiss" +
 * „Learn more" apăreau în scanul de pagină și, împreună cu orice cuvânt de
 * limită din DOM, produceau un `plan_limit` fals pe un cont Pro.
 */
const PROVIDER_PROMO_NOISE_RE = /\bupgrade for more\b|\bdismiss\b|\blearn more\b|\bnot now\b/i;
/** true dacă textul e doar promo/chrome (nu o eroare de provider). */
function isProviderPromoNoise(text) {
    return PROVIDER_PROMO_NOISE_RE.test(String(text ?? ''));
}
/** Câte dintre cele 3 semnale sunt prezente. */
function limitSignalCount(s) {
    return (s.textInChat ? 1 : 0) + (s.inputDisabled ? 1 : 0) + (s.sendHidden ? 1 : 0);
}
/**
 * v2.5.74 (FIX 3): limita (plan/cotă/rate) e CONFIRMATĂ doar cu ≥2 din cele 3
 * semnale. Un banner de upsell într-un cont care funcționează normal are cel
 * mult 1 (textul „limit" din banner) → nu mai raportăm eroare falsă.
 */
function confirmLimit(signals) {
    return limitSignalCount(signals) >= 2;
}
/**
 * v2.5.43 (bug #100): textul care semnalează o limită de plan/cotă (bannere de
 * tip „You've reached your free plan limit", „Quota exceeded", „Try again
 * later"). Folosit atât de scanul de pagină, cât și direct pe răspunsul citit.
 */
function isPlanLimitText(text) {
    return PLAN_LIMIT_RE.test(String(text ?? ''));
}
/**
 * v2.5.43 (bug #100): URL-ul de upgrade cunoscut pentru provider — folosit doar
 * când pagina nu expune un link de upgrade/plans/pricing pe care să-l citim
 * din DOM (acela e mereu preferat, fiind URL-ul real al providerului).
 */
function upgradeUrlFor(providerId) {
    if (providerId === 'claude')
        return 'https://claude.ai/upgrade';
    if (providerId === 'chatgpt')
        return 'https://chat.openai.com/upgrade';
    return undefined;
}
/**
 * v2.5.1: detectează erorile cunoscute în textul brut (răspuns extras din DOM
 * sau textul paginii). Întoarce `null` dacă nu recunoaște nicio eroare.
 *
 * v2.5.43 (bug #100): `upgradeUrl` (opțional) = linkul de upgrade/plans/pricing
 * găsit în DOM — întărește detecția „free plan" când bannerul e vag și pune
 * URL-ul real pe cardul din chat.
 */
function detectProviderError(rawText, providerId, upgradeUrl, 
/**
 * v2.5.74 (FIX 3): semnalele din pagină. Când sunt furnizate, `plan_limit` /
 * `rate_limit` se raportează doar dacă sunt confirmate de ≥2 din 3 semnale —
 * altfel un banner de upsell („Upgrade for more") dintr-un cont Pro producea
 * o eroare falsă. Fără semnale (detecția pe textul răspunsului) comportamentul
 * rămâne cel de dinainte.
 */
signals) {
    if (!rawText)
        return null;
    // v2.5.15 (bug #41): contextul chatului s-a epuizat (ChatGPT free ~8k
    // tokens). Bannerul nu intră în selectorii de răspuns, deci fără detecție
    // agentic loop-ul continua să trimită nudges într-un chat care nu mai poate
    // răspunde, până la timeout.
    if (isMemoryFullText(rawText)) {
        return { kind: 'memory_full', message: 'Chat context limit reached.' };
    }
    // v2.5.11 (bug #25): Ollama — modelul cerut nu e instalat.
    // Corpul răspunsului: `{"error":"model \"x\" not found, try pulling it first"}`.
    if (providerId === 'ollama') {
        const notFound = rawText.match(/model\s+["']?([^"'\n,]+?)["']?\s+not found|try pulling it first/i);
        if (notFound) {
            return ollamaModelMissing((notFound[1] || '').trim(), []);
        }
    }
    // Out of messages / usage limit
    // v2.5.1: terminator tolerant — bannerele pot termina cu „.”, „!”, newline
    // sau direct la finalul textului (fără punctuație).
    const outMatch = rawText.match(/out of (free )?messages?( until (.+?))?(?:[.\n!]|$)/i);
    if (outMatch) {
        return {
            kind: 'out_of_messages',
            message: outMatch[0].trim(),
            resetTime: outMatch[3]?.trim(),
            upgradeUrl: upgradeUrl || upgradeUrlFor(providerId)
        };
    }
    // v2.5.43 (bug #100): plan gratuit / cotă epuizată — bannerele de tip
    // „You've reached your free plan limit", „Quota exceeded", „Try again
    // later" nu erau recunoscute deloc, deci chatul se trunchia (tool calls
    // incomplete ⇒ edit_file eșua) iar utilizatorul nu afla care e cauza.
    // v2.5.74 (FIX 3): textul de promo/chrome („Upgrade for more", „Dismiss",
    // „Learn more") nu e o eroare de provider, iar limita se raportează doar
    // când e confirmată de semnalele din pagină.
    const limitConfirmed = !signals || confirmLimit(signals);
    const planHit = rawText.match(PLAN_LIMIT_RE);
    if (planHit && !isProviderPromoNoise(planHit[0]) && limitConfirmed) {
        return {
            kind: 'plan_limit',
            message: planHit[0].trim(),
            upgradeUrl: upgradeUrl || upgradeUrlFor(providerId)
        };
    }
    // Cuvântul „upgrade" singur nu e dovadă — dar împreună cu un link de
    // upgrade/plans/pricing din DOM și un cuvânt de limită, este.
    if (upgradeUrl &&
        limitConfirmed &&
        /limit|quota|free plan|reached|out of|try again|too many|upgrade (?:your|to|now)/i.test(rawText)) {
        return {
            kind: 'plan_limit',
            message: 'free plan / quota limit',
            upgradeUrl
        };
    }
    // Login required
    if (/please log ?in|sign in to continue|log in to continue/i.test(rawText)) {
        return { kind: 'login_required', message: 'You need to log in.' };
    }
    // Rate limit — v2.5.74 (FIX 3): aceeași confirmare ca la `plan_limit`.
    const rateHit = rawText.match(/rate limit|too many requests|try again in/i);
    if (rateHit && !isProviderPromoNoise(rateHit[0]) && limitConfirmed) {
        return { kind: 'rate_limit', message: 'Rate limit reached.', upgradeUrl };
    }
    // CAPTCHA
    if (/captcha|verify you are human|are you a robot/i.test(rawText)) {
        return { kind: 'captcha', message: 'CAPTCHA detected.' };
    }
    return null;
}
/**
 * v2.5.1: eroare specifică, cu datele detecției — chatView o afișează ca mesaj
 * clar în chat (și, cu FIX 2, ca card cu buton Retry).
 */
class DetectedProviderError extends Error {
    providerId;
    details;
    code = exports.PROVIDER_ERROR_CODE;
    constructor(providerId, details) {
        super(providerErrorMessage(providerId, details));
        this.providerId = providerId;
        this.details = details;
        this.name = 'DetectedProviderError';
    }
}
exports.DetectedProviderError = DetectedProviderError;
/** Mesaj uman, clar, pentru o eroare de provider detectată. */
function providerErrorMessage(providerId, e) {
    const name = PROVIDER_LABELS[providerId] || providerId || 'The provider';
    switch (e.kind) {
        case 'out_of_messages':
            return (name +
                ' is out of free messages' +
                (e.resetTime ? ' until ' + e.resetTime : '') +
                '. ' +
                (e.upgradeUrl
                    ? 'Upgrade for more messages: ' + e.upgradeUrl
                    : 'Wait for the limit to reset, or switch to another model.'));
        case 'login_required':
            return ('You are logged out of ' + name + '. Log in through the Chrome window, then retry.');
        case 'rate_limit':
            return (name + ' is rate-limiting requests right now. Wait a minute, then retry.');
        case 'plan_limit':
            // v2.5.48: mesaj clar pentru limita temporară de provider (ex: DeepSeek
            // „is limiting this account") — cât aștepți și ce alternative ai.
            return (name +
                ' reached its temporary limit (' +
                e.message +
                '). Wait 15–30 minutes and try again, or switch to another provider.' +
                (e.upgradeUrl ? ' Upgrade for more messages: ' + e.upgradeUrl : ''));
        case 'captcha':
            return (name +
                ' requires CAPTCHA verification ("I\'m not a robot"). Solve it in the Chrome window, then retry.');
        case 'memory_full':
            return (name +
                ' reached its context limit ("Chat memory full"), so it stopped answering. ' +
                'Start a new chat and continue the task there.');
        case 'provider_down':
            return (e.message + ' Restart ' + name + ' (or switch provider), then retry.');
        case 'no_response':
            // v2.5.60: mesajul cerut de spec — diagnostice clare, nu un timeout sec.
            // v2.5.70 (FIX 2): pragul de „provider blocat" urcă de la 60s la 90s,
            // aliniat cu bugetul implicit (`freekit.providerTimeout`).
            return ('[' + name + '] no response after 90s — provider stuck, try again or switch.');
        case 'model_missing':
            return ((e.model ? 'Model "' + e.model + '"' : 'The configured Ollama model') +
                ' is not installed in Ollama.' +
                (e.availableModels?.length
                    ? ' Installed: ' + e.availableModels.join(', ') + '.'
                    : '') +
                ' Download it from the model menu (⋯ → model chip).');
        default:
            return name + ': ' + e.message;
    }
}
//# sourceMappingURL=providerErrors.js.map