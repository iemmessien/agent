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
exports.COMPARE_PROMPT = exports.DEFAULT_VISION_PROVIDER = exports.VISION_PROVIDERS = exports.SCREENSHOTS_DIR = void 0;
exports.supportsVision = supportsVision;
exports.pickVisionProvider = pickVisionProvider;
exports.timestamp = timestamp;
exports.toTargetUrl = toTargetUrl;
exports.countDifferences = countDifferences;
exports.locateElementByDescription = locateElementByDescription;
exports.captureScreenshot = captureScreenshot;
exports.compareVisual = compareVisual;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const url_1 = require("url");
const log_1 = require("./log");
/* =========================================================================
 * v2.5.51 — VISION: tool-urile `screenshot` și `compare_visual`
 *
 * `screenshot` capturează o pagină (sau un element) prin CDP — aceeași
 * conexiune Playwright/Chrome pe care Freekit o folosește deja pentru chatul
 * web — și o salvează în `docs/screenshots/`.
 *
 * `compare_visual` capturează originalul și replica, apoi trimite AMBELE
 * imagini unui provider cu vision (FIX 2) și scrie diferențele în
 * `docs/screenshots/compare-<timestamp>.md`.
 *
 * Toți cei 6 provideri web (DeepSeek, ChatGPT, Claude, Gemini, Mistral, Qwen)
 * primesc imagini prin upload-ul din chat — vezi `uploadChatFiles`, care
 * găsește generic `input[type=file]` în pagină. Ollama rămâne pe dinafară:
 * modelele locale nu sunt multimodale (FIX 3 → se comută pe un provider web).
 * ========================================================================= */
/** Folderul (relativ la rădăcina workspace-ului) în care se salvează capturile. */
exports.SCREENSHOTS_DIR = 'docs/screenshots';
/** Providerii care pot primi imagini (FIX 3). */
exports.VISION_PROVIDERS = new Set([
    'chatgpt',
    'claude',
    'gemini',
    'deepseek',
    'mistral',
    'qwen'
]);
/**
 * v2.5.51 (FIX 4): Qwen3-VL e cel mai bun pentru comparații vizuale (visual
 * coding, spatial understanding, multi-image, OCR). E folosit ca fallback când
 * nici providerul curent, nici ultimul provider web nu pot primi imagini.
 */
exports.DEFAULT_VISION_PROVIDER = 'qwen';
/** Promptul de comparație (FIX 2) — identic pentru toți providerii. */
exports.COMPARE_PROMPT = 'Compare these two screenshots. List ALL differences: layout, colors, ' +
    'spacing, text, images, fonts, missing elements. Be specific.';
const NAV_TIMEOUT_MS = 45_000;
const LOAD_TIMEOUT_MS = 20_000;
/** Cât așteptăm ultima „pensulă" (fonturi, imagini) înainte de captură. */
const SETTLE_MS = 500;
/** Plafon de pași la derularea care trezește conținutul „lazy". */
const MAX_PRIME_STEPS = 25;
/** True dacă providerul poate primi imagini. */
function supportsVision(providerId) {
    return exports.VISION_PROVIDERS.has(String(providerId ?? '').trim().toLowerCase());
}
/**
 * FIX 3 — cine analizează imaginile: providerul curent dacă are vision, altfel
 * ultimul provider web folosit, altfel Qwen3-VL (cel mai bun la vizual).
 */
function pickVisionProvider(current, fallback) {
    const cur = String(current ?? '').trim().toLowerCase();
    if (supportsVision(cur))
        return cur;
    const fb = String(fallback ?? '').trim().toLowerCase();
    if (supportsVision(fb))
        return fb;
    return exports.DEFAULT_VISION_PROVIDER;
}
/* =========================================================================
 * UTILITARE
 * ========================================================================= */
/** Timestamp compact, sigur ca nume de fișier (ex: 20261008-120000). */
function timestamp(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return (d.getFullYear() +
        p(d.getMonth() + 1) +
        p(d.getDate()) +
        '-' +
        p(d.getHours()) +
        p(d.getMinutes()) +
        p(d.getSeconds()));
}
/**
 * `url_or_path` → URL navigabil. Acceptă http(s)/file absoluts, căi locale
 * (relative la rădăcina workspace-ului, cu „\" sau „/") și adrese de tip
 * `localhost:4321/...` scrise fără schemă.
 */
function toTargetUrl(raw, root) {
    const value = String(raw ?? '').trim();
    if (!value)
        throw new Error('empty URL');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value))
        return value;
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(value)) {
        return 'http://' + value;
    }
    const abs = path.isAbsolute(value) ? value : path.resolve(root, value);
    return (0, url_1.pathToFileURL)(abs).href;
}
/** Dimensiunile unui PNG, citite din header-ul IHDR (fără dependențe). */
function pngSize(buf) {
    if (buf.length > 24 &&
        buf.toString('latin1', 12, 16) === 'IHDR') {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    return { width: 0, height: 0 };
}
/**
 * Câte diferențe a raportat modelul: numără liniile de listă („- ", „* ", „1.")
 * și, dacă răspunsul e text curgător, cade pe liniile pline.
 */
function countDifferences(reply) {
    let bullets = 0;
    let filled = 0;
    for (const line of String(reply ?? '').split('\n')) {
        const t = line.trim();
        if (!t)
            continue;
        filled++;
        if (/^(?:[-*•‣]|\d+[.)])\s+\S/.test(t))
            bullets++;
    }
    return bullets || filled;
}
/* =========================================================================
 * FIX 1 — SCREENSHOT
 * ========================================================================= */
/**
 * Derulează pagina până jos și înapoi, ca să se declanșeze imaginile/motoarele
 * „lazy" și animațiile de intrare. Fără asta, o captură `full_page` prinde o
 * pagină pe jumătate goală (exact cazul care contează la replicare).
 * Best-effort și cu plafon de timp.
 */
async function primeLazyContent(page) {
    try {
        await page.evaluate(async (maxSteps) => {
            const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
            const height = document.body ? document.body.scrollHeight : 0;
            let steps = 0;
            for (let y = 0; y < height && steps < maxSteps; y += step, steps++) {
                window.scrollTo(0, y);
                await new Promise((r) => setTimeout(r, 100));
            }
            window.scrollTo(0, 0);
        }, MAX_PRIME_STEPS);
    }
    catch {
        /* pagini care blochează scriptul: capturăm ce s-a încărcat */
    }
}
/** Indicii de tip de element din descrierea în limbaj natural (FIX 10). */
const TAG_HINTS = [
    { test: /\b(buton|button|btn)\b/i, selector: 'button, a, [role="button"], input[type="submit"], input[type="button"]' },
    { test: /\b(link|legatur[aă]|hyperlink)\b/i, selector: 'a' },
    { test: /\b(imagine|image|poza|foto|logo)\b/i, selector: 'img, svg, picture' },
    { test: /\b(titlu|heading|title|h[1-6])\b/i, selector: 'h1, h2, h3, h4, h5, h6' },
    { test: /\b(formular|form)\b/i, selector: 'form' },
    { test: /\b(tabel|table)\b/i, selector: 'table' },
    { test: /\b(card|pachet|package)\b/i, selector: '.card, [class*="card"], [class*="package"], [class*="pachet"]' },
    { test: /\b(meniu|menu|nav|navbar)\b/i, selector: 'nav, [role="navigation"], header' },
    { test: /\b(footer|subsol)\b/i, selector: 'footer' },
    { test: /\b(header|antet)\b/i, selector: 'header' },
    { test: /\b(sec[tț]iune|section)\b/i, selector: 'section' },
    { test: /\b(input|c[âa]mp)\b/i, selector: 'input, textarea, select' },
    { test: /\b(pre[tț]|price|pricing)\b/i, selector: '[class*="price"], [id*="price"], [class*="pret"]' }
];
/** Cuvinte de umplutură scoase din descriere înainte de potrivirea textului. */
const STOPWORDS = new Set([
    'the', 'a', 'an', 'of', 'from', 'with', 'and', 'or', 'element', 'elementul',
    'this', 'that', 'de', 'la', 'din', 'cu', 'si', 'și', 'sau', 'un', 'o', 'al',
    'ale', 'cel', 'cea', 'acest', 'aceasta', 'această', 'buton', 'butonul',
    'imaginea', 'titlul', 'sectiunea', 'secțiunea', 'cardul'
]);
/**
 * v2.5.54 (FIX 10) — găsește un element pornind de la o DESCRIERE în limbaj
 * natural („butonul CTA"). Ordinea: selector CSS (dacă descrierea pare unul) →
 * tip de element dedus din descriere (`<button>`/`<a>` + textul rămas) → text
 * vizibil → rol/label/alt/title → `id`/`class`/`aria-label`/`data-testid` →
 * container care conține textul. Întoarce elementul + selectorul rezolvat.
 */
async function locateElementByDescription(page, description) {
    const desc = String(description ?? '').trim();
    if (!desc)
        throw new Error('empty element description');
    const words = desc
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((w) => w.trim())
        .filter((w) => w && !STOPWORDS.has(w.toLowerCase()));
    const text = words.join(' ');
    const needle = esc(text || desc);
    const candidates = [];
    if (/^[.#]/.test(desc) || /[[\]>~+]/.test(desc)) {
        candidates.push({ selector: desc, make: () => page.locator(desc) });
    }
    for (const hint of TAG_HINTS) {
        if (!hint.test.test(desc))
            continue;
        candidates.push({
            selector: hint.selector + (text ? ':has-text("' + needle + '")' : ''),
            make: () => text
                ? page.locator(hint.selector).filter({ hasText: text })
                : page.locator(hint.selector)
        });
    }
    candidates.push({ selector: '[id*="' + needle + '"]', make: () => page.locator('[id*="' + needle + '"]') }, { selector: '[class*="' + needle + '"]', make: () => page.locator('[class*="' + needle + '"]') }, { selector: '[aria-label*="' + needle + '"]', make: () => page.locator('[aria-label*="' + needle + '"]') }, { selector: '[alt*="' + needle + '"]', make: () => page.locator('[alt*="' + needle + '"]') }, { selector: '[title*="' + needle + '"]', make: () => page.locator('[title*="' + needle + '"]') }, { selector: '[data-testid*="' + needle + '"]', make: () => page.locator('[data-testid*="' + needle + '"]') }, { selector: 'heading role name="' + needle + '"', make: () => page.getByRole('heading', { name: desc }) }, { selector: 'button role name="' + needle + '"', make: () => page.getByRole('button', { name: desc }) }, { selector: 'link role name="' + needle + '"', make: () => page.getByRole('link', { name: desc }) }, { selector: 'text="' + needle + '"', make: () => page.getByText(desc, { exact: false }) }, { selector: 'label="' + needle + '"', make: () => page.getByLabel(desc, { exact: false }) }, { selector: 'placeholder="' + needle + '"', make: () => page.getByPlaceholder(desc, { exact: false }) }, { selector: 'alt text="' + needle + '"', make: () => page.getByAltText(desc, { exact: false }) }, { selector: 'title attr="' + needle + '"', make: () => page.getByTitle(desc, { exact: false }) }, {
        selector: 'section/article/header/footer/form/div:has-text("' + needle + '")',
        make: () => page
            .locator('section, article, header, footer, aside, form, div')
            .filter({ hasText: text || desc })
    });
    for (const candidate of candidates) {
        try {
            const locator = candidate.make();
            if ((await locator.count()) > 0) {
                return { locator: locator.first(), selector: candidate.selector };
            }
        }
        catch {
            /* candidat invalid (ex: selector malformat) — trecem la următorul */
        }
    }
    throw new Error('Nu am găsit elementul "' + desc +
        '" — no element matches this description; use an exact CSS selector in `args.selector` instead.');
}
/** Escapează o descriere pentru un selector/atribut (fără „/" și ghilimele). */
function esc(text) {
    return text.replace(/["\\\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Padding-ul (px) adăugat în jurul elementului capturat (FIX 10). */
const ELEMENT_PADDING = 10;
/**
 * v2.5.54 (FIX 10) — capturează elementul cu 10px de padding în jur (imaginea
 * arată contextul, nu doar cutia exactă). Cascadă: clip document-relativ peste
 * full page → clip simplu → captura elementului fără padding.
 */
async function captureElementWithPadding(page, locator) {
    try {
        await locator.scrollIntoViewIfNeeded().catch(() => undefined);
        const box = await locator.evaluate((node) => {
            const r = node.getBoundingClientRect();
            return {
                x: r.x + window.scrollX,
                y: r.y + window.scrollY,
                width: r.width,
                height: r.height
            };
        });
        if (box && box.width > 0 && box.height > 0) {
            const clip = {
                x: Math.max(0, Math.round(box.x - ELEMENT_PADDING)),
                y: Math.max(0, Math.round(box.y - ELEMENT_PADDING)),
                width: Math.round(box.width + ELEMENT_PADDING * 2),
                height: Math.round(box.height + ELEMENT_PADDING * 2)
            };
            try {
                return await page.screenshot({ type: 'png', clip, fullPage: true });
            }
            catch {
                /* clip + fullPage refuzat de versiune → încercăm clip simplu */
            }
            try {
                return await page.screenshot({ type: 'png', clip });
            }
            catch {
                /* cădem pe captura elementului, fără padding */
            }
        }
    }
    catch {
        /* evaluarea/derularea a eșuat — continuăm cu captura elementului */
    }
    return locator.screenshot({ type: 'png' });
}
/**
 * Capturează `url` într-un tab dedicat (chatul activ nu e atins) și salvează
 * PNG-ul în `docs/screenshots/`. Tab-ul se închide mereu la final.
 */
async function captureScreenshot(browser, url, root, opts = {}) {
    const page = await browser.newPage();
    try {
        const vp = opts.viewport;
        if (vp && vp.width > 0 && vp.height > 0) {
            await page.setViewportSize({
                width: Math.round(vp.width),
                height: Math.round(vp.height)
            });
        }
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await page.waitForLoadState('load', { timeout: LOAD_TIMEOUT_MS }).catch(() => undefined);
        // fonturile schimbă layoutul → așteptăm să fie gata înainte de captură
        await page
            .evaluate(() => document.fonts.ready.then(() => true))
            .catch(() => undefined);
        // v2.5.54 (FIX 9): FULL PAGE implicit — doar `full_page: false` îl dezactivează.
        const fullPage = opts.fullPage !== false;
        if (opts.fullPage === undefined)
            (0, log_1.logLine)('screenshot', 'full_page defaulted to true');
        const target = opts.selector ?? opts.description;
        if (fullPage && !target)
            await primeLazyContent(page);
        await page.waitForTimeout(SETTLE_MS);
        let buffer;
        let resolvedSelector;
        if (target) {
            let locator;
            if (opts.selector) {
                locator = page.locator(opts.selector).first();
                resolvedSelector = opts.selector;
            }
            else {
                const found = await locateElementByDescription(page, String(opts.description));
                locator = found.locator;
                resolvedSelector = found.selector;
                (0, log_1.logLine)('screenshot', 'description "' + opts.description + '" resolved to selector "' + resolvedSelector + '"');
            }
            await locator.waitFor({ state: 'visible', timeout: 10_000 });
            buffer = await captureElementWithPadding(page, locator);
            const size = pngSize(buffer);
            (0, log_1.logLine)('screenshot', 'element ' + resolvedSelector + ' captured (' + size.width + 'x' + size.height + ')');
        }
        else {
            buffer = await page.screenshot({ type: 'png', fullPage });
        }
        const { width, height } = pngSize(buffer);
        const relPath = exports.SCREENSHOTS_DIR + '/' + (opts.name ?? timestamp()) + '.png';
        const absPath = path.join(root, exports.SCREENSHOTS_DIR, path.basename(relPath));
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, buffer);
        const kb = Math.max(1, Math.round(buffer.length / 1024));
        (0, log_1.logLine)('screenshot', 'captured ' +
            url +
            (target ? ' [' + resolvedSelector + ']' : fullPage ? ' [full page]' : ' [viewport]') +
            ' → ' +
            relPath +
            ' (' +
            width +
            'x' +
            height +
            ', ' +
            kb +
            ' KB)');
        return {
            relPath,
            absPath,
            width,
            height,
            bytes: buffer.length,
            element: target,
            selector: resolvedSelector
        };
    }
    finally {
        await page.close().catch(() => undefined);
    }
}
function buildCompareReport(url1, url2, provider, differences, reply, original, replica) {
    return ('# Visual comparison\n' +
        '\n' +
        '- **Original:** ' + url1 + '\n' +
        '- **Replica:** ' + url2 + '\n' +
        '- **Provider:** ' + provider + '\n' +
        '- **Date:** ' + new Date().toISOString() + '\n' +
        '- **Screenshots:** `' + original.relPath + '`, `' + replica.relPath + '`\n' +
        '\n' +
        '## Differences (' + differences + ')\n' +
        '\n' +
        reply.trim() + '\n');
}
/**
 * Capturează originalul și replica, cere providerului cu vision să listeze
 * diferențele și scrie raportul în `docs/screenshots/compare-<timestamp>.md`.
 */
async function compareVisual(ctx, root, url1, url2, opts = {}) {
    const ts = timestamp();
    const original = await captureScreenshot(ctx.browser, url1, root, {
        fullPage: opts.fullPage,
        name: ts + '-original'
    });
    const replica = await captureScreenshot(ctx.browser, url2, root, {
        fullPage: opts.fullPage,
        name: ts + '-replica'
    });
    const prompt = exports.COMPARE_PROMPT +
        '\n\nScreenshot 1 (ORIGINAL): ' +
        url1 +
        '\nScreenshot 2 (REPLICA): ' +
        url2;
    const { provider, reply } = await ctx.analyze(prompt, [original.absPath, replica.absPath], opts.provider);
    const differences = countDifferences(reply);
    const relPath = exports.SCREENSHOTS_DIR + '/compare-' + ts + '.md';
    const absPath = path.join(root, exports.SCREENSHOTS_DIR, path.basename(relPath));
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buildCompareReport(url1, url2, provider, differences, reply, original, replica), 'utf8');
    (0, log_1.logLine)('compare', url1 + ' vs ' + url2 + ' → ' + differences + ' differences found');
    return { relPath, absPath, differences, reply, provider, original, replica };
}
//# sourceMappingURL=visual.js.map