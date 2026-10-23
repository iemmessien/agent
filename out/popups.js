"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXCLUDE_REGEX_SOURCE = exports.WEAK_TEXTS = exports.MEDIUM_TEXTS = exports.STRONG_TEXTS = void 0;
exports.popupSettings = popupSettings;
exports.normalizePopupText = normalizePopupText;
exports.isExcludedPopupText = isExcludedPopupText;
exports.popupIntent = popupIntent;
exports.autoAcceptPopups = autoAcceptPopups;
const DEFAULT_SETTINGS = { enabled: true };
/** Setările popup-urilor (require lazy de vscode — teste Node safe). */
function popupSettings() {
    try {
        const v = require('vscode');
        const cfg = v.workspace.getConfiguration('freekit');
        return { enabled: cfg.get('autoAcceptPopups', true) };
    }
    catch {
        return { ...DEFAULT_SETTINGS };
    }
}
/** Textele pe niveluri (după normalizare). */
exports.STRONG_TEXTS = [
    'accept all',
    'accept all cookies',
    'accept cookies',
    'accept all and continue',
    'agree to all',
    'allow all',
    'allow all cookies',
    'acceptă toate',
    'accept toate',
    'acceptati toate',
    'acceptați toate',
    'acceptă toate cookie urile',
    'accept toate cookie urile'
];
exports.MEDIUM_TEXTS = [
    'accept',
    'acceptă',
    'accepta',
    'acceptați',
    'acceptati',
    'i accept',
    'i agree',
    'agree',
    'got it',
    'allow',
    'allow cookies',
    'de acord',
    'acord',
    'accept and continue',
    'accept și continuă',
    'accept si continua'
];
exports.WEAK_TEXTS = ['ok', 'okay', 'am înțeles', 'am inteles', 'înțeleg', 'inteleg'];
/**
 * Cuvinte care descalifică un element („Reject all”, „Only necessary”,
 * „Customize”, „Not now”, „Close”…). Sursa regex e partajată cu scanarea
 * in-page (funcția serializată nu poate închide peste constante).
 */
exports.EXCLUDE_REGEX_SOURCE = '(?:reject|decline|refus|deny|resping|refuz|anulea|renun[tț]|necessary|essential|necesar|esential|only|customiz|manage|settings|preferin|not now|no thanks|nu, mul|mul[tț]umesc|t[âa]rziu|later|skip|close|inchide|închide)';
/** Normalizare: litere mici, doar litere/cifre/spații (scoate emoji, săgeți, punctuație). */
function normalizePopupText(raw) {
    return String(raw ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
/** true dacă textul (deja normalizat) sună a refuz/altă acțiune — nu îl atingem. */
function isExcludedPopupText(normalized) {
    return new RegExp('(^|[^\\p{L}])' + exports.EXCLUDE_REGEX_SOURCE, 'u').test(normalized);
}
/**
 * Nivelul de încredere al unui text: 3 = strong, 2 = medium, 1 = weak, 0 = nimic.
 * Pur (fără DOM) — testabil direct în Node.
 */
function popupIntent(rawText) {
    const text = normalizePopupText(rawText);
    if (!text || isExcludedPopupText(text))
        return 0;
    if (exports.STRONG_TEXTS.includes(text))
        return 3;
    if (exports.MEDIUM_TEXTS.includes(text))
        return 2;
    if (exports.WEAK_TEXTS.includes(text))
        return 1;
    return 0;
}
/**
 * Rulează ÎN PAGINĂ: găsește cel mai bun buton de acceptare vizibil și dă
 * click pe el. Întoarce textul apăsat sau null. (Serializată de Playwright —
 * toate constantele vin prin `args`.)
 */
const scanPopupsInPage = (args) => {
    const norm = (s) => String(s ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const exclRe = new RegExp('(^|[^\\p{L}])' + args.excludeSource, 'u');
    const containerSel = '[role="dialog"],[role="alertdialog"],[role="alert"],dialog,' +
        '[class*="modal" i],[class*="cookie" i],[class*="consent" i],[class*="banner" i],' +
        '[class*="popup" i],[class*="overlay" i],[class*="notice" i],[class*="toast" i],[class*="alert" i]';
    const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2)
            return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
    };
    const candidates = [];
    const els = Array.prototype.slice.call(document.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]'));
    for (const el of els) {
        if (el.disabled)
            continue;
        if (el.getAttribute('aria-disabled') === 'true')
            continue;
        if (el.getAttribute('data-freekit-accepted'))
            continue; // deja apăsat de noi (anti-dublare)
        if (!isVisible(el))
            continue;
        const texts = [
            el.tagName === 'INPUT' ? el.value : el.innerText,
            el.getAttribute('aria-label') ?? '',
            el.getAttribute('title') ?? ''
        ];
        let tier = 0;
        let chosen = '';
        for (const raw of texts) {
            const n = norm(raw);
            if (!n || exclRe.test(n))
                continue;
            const tr = args.strong.includes(n) ? 3 : args.medium.includes(n) ? 2 : args.weak.includes(n) ? 1 : 0;
            if (tr > tier) {
                tier = tr;
                chosen = n;
            }
        }
        if (!tier)
            continue;
        const isLink = el.tagName === 'A';
        if (isLink && tier < 3)
            continue; // linkurile doar pentru texte foarte sigure
        if (tier === 1 && !el.closest(containerSel))
            continue; // „OK” doar în dialog/banner
        const isButton = el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.getAttribute('role') === 'button';
        candidates.push({ el, tier, text: chosen, isButton });
    }
    if (!candidates.length)
        return null;
    candidates.sort((a, b) => b.tier - a.tier || Number(b.isButton) - Number(a.isButton));
    const winner = candidates[0];
    // marcăm elementul ÎNAINTE de click: același buton nu mai e apăsat a doua
    // oară în rundele următoare (bannere care nu dispar din DOM)
    winner.el.setAttribute('data-freekit-accepted', '1');
    try {
        winner.el.click();
    }
    catch {
        return null;
    }
    return { text: winner.text, tier: winner.tier };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Închide popup-urile de consimțământ găsite în pagină (inclusiv în iframe-uri:
 * consimțământul Google trăiește într-un iframe cross-origin). Întoarce
 * textele apăsate (gol = nimic găsit sau funcția dezactivată). Nu aruncă niciodată.
 */
async function autoAcceptPopups(page, opts = {}) {
    const accepted = [];
    try {
        if (!popupSettings().enabled)
            return accepted;
        const maxRounds = Math.max(1, Math.min(opts.maxRounds ?? 3, 5));
        const args = {
            strong: exports.STRONG_TEXTS,
            medium: exports.MEDIUM_TEXTS,
            weak: exports.WEAK_TEXTS,
            excludeSource: exports.EXCLUDE_REGEX_SOURCE
        };
        for (let round = 0; round < maxRounds; round++) {
            let clicked = null;
            for (const frame of page.frames()) {
                try {
                    const res = await frame.evaluate(scanPopupsInPage, args);
                    if (res) {
                        clicked = res;
                        break;
                    }
                }
                catch {
                    /* frame detașat / navigare în curs */
                }
            }
            if (!clicked)
                break;
            accepted.push(clicked.text);
            opts.log?.('popup închis: „' + clicked.text + '" (nivel ' + clicked.tier + ')');
            await sleep(800);
        }
    }
    catch (e) {
        opts.log?.('autoAcceptPopups a eșuat: ' + (e?.message ?? String(e)));
    }
    return accepted;
}
//# sourceMappingURL=popups.js.map