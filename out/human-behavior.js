"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.humanBehaviorEnabled = exports.humanTypingEnabled = exports.MAX_TOTAL_NATURAL = exports.NATURAL_TYPING_MAX_CHARS = void 0;
exports.humanType = humanType;
exports.humanMoveToElement = humanMoveToElement;
exports.humanClick = humanClick;
exports.humanClickButton = humanClickButton;
exports.humanScroll = humanScroll;
exports.humanSettings = humanSettings;
const log_1 = require("./log");
const log = (msg) => (0, log_1.logLine)('human', msg);
const DEFAULT_OPTIONS = {
    minDelay: 5,
    maxDelay: 15,
    punctuationPause: 150,
    burstProbability: 0.15,
    burstLength: 8
};
/**
 * v2.5.21 (bug #52 + #53): câte caractere de la începutul unui mesaj se tastează
 * „natural”. Capul tastat nu ajută la nimic peste câteva zeci de caractere.
 */
exports.NATURAL_TYPING_MAX_CHARS = 100;
/**
 * v2.5.21 (bug #52 + #53): peste acest prag mesajul NU se mai tastează natural
 * deloc — se lipește dintr-o singură bucată (`insertText`). Payload-urile mari
 * (tool calls de zeci de mii de caractere) pierdeau minute întregi tastând un
 * cap „uman” de câteva zeci de caractere înainte de lipirea restului.
 */
exports.MAX_TOTAL_NATURAL = 1000;
/**
 * Tastează text ca un om: delay aleatoriu, pauze la punctuație, burst-uri ocazionale.
 * `signal` (opțional): la anulare aruncă '__ABORTED__' — ca restul fluxului.
 *
 * v2.0.6: caracterele trec prin `page.keyboard.type()`, deci Chrome primește
 * evenimente REALE de keydown/keypress/keyup (anti-detect-ul care numără doar
 * `insertText` nu mai vede o lipire instantă). Mesajele lungi rămân rapide.
 *
 * v2.5.21 (bug #52 + #53): payload-urile mari (peste `MAX_TOTAL_NATURAL`) se
 * lipesc direct, fără nicio tastare naturală — un cap „uman” de câteva zeci de
 * caractere pe un mesaj de 40k adăuga doar întârziere. Sub prag se tastează
 * natural doar primele `NATURAL_TYPING_MAX_CHARS` caractere, restul lipit.
 *
 * v2.5.14 (bug #39): tastarea „naturală” se oprește ÎNAINTE de primul \r/\n —
 * pe ChatGPT un `insertText('\n')` izolat echivalează cu Enter: mesajul pleca
 * trunchiat la prima linie, restul rămânea draft în composer și polua mesajul
 * următor. Restul mesajului (inclusiv primul newline) se lipește dintr-o
 * singură bucată.
 */
async function humanType(page, text, options = {}, signal) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    if (!text)
        return;
    // v2.5.21 (bug #52 + #53): mesajele uriașe se lipesc dintr-o bucată — 0 tastare.
    if (text.length > exports.MAX_TOTAL_NATURAL) {
        if (signal?.aborted)
            throw new Error('__ABORTED__');
        const t0 = Date.now();
        await page.keyboard.insertText(text);
        log('pasted ' + text.length + ' chars in ' + (Date.now() - t0) + 'ms (large message — human typing skipped)');
        return;
    }
    const naturalHead = Math.min(exports.NATURAL_TYPING_MAX_CHARS, text.length);
    // v2.5.14 (bug #39): niciodată \r sau \n în capul tastat „natural”.
    const firstBreak = text.search(/[\r\n]/);
    const headLength = firstBreak >= 0 ? Math.min(naturalHead, firstBreak) : naturalHead;
    log('typing ' + headLength + '/' + text.length + ' chars with human delay');
    await typeNaturally(page, text.slice(0, headLength), opts, signal);
    // Restul (doar la mesajele lungi): o singură lipire — un om nu tastează
    // 5000 de caractere, iar caracter-cu-caracter ar dura minute întregi.
    if (headLength < text.length) {
        if (signal?.aborted)
            throw new Error('__ABORTED__');
        const rest = text.slice(headLength);
        const t0 = Date.now();
        await page.keyboard.insertText(rest);
        log('pasted the remaining ' + rest.length + ' chars in ' + (Date.now() - t0) + 'ms');
    }
    log('typing finished');
}
/**
 * v2.0.6: tastează un fragment cu evenimente reale de tastatură. `\n` NU are
 * voie să treacă prin `type()` — Playwright îl trimite ca tasta Enter, iar în
 * composerul de chat Enter = „trimite mesajul”. Newline-ul se scrie ca text.
 */
async function typeChunk(page, chunk, delay) {
    for (const part of chunk.split(/(\r?\n)/)) {
        if (!part)
            continue;
        if (part === '\n' || part === '\r\n') {
            await page.keyboard.insertText(part);
            continue;
        }
        await page.keyboard.type(part, { delay });
    }
}
/** Bucla de tastare „umană” (burst-uri + pauze de punctuație / gândire). */
async function typeNaturally(page, text, opts, signal) {
    let i = 0;
    while (i < text.length) {
        if (signal?.aborted)
            throw new Error('__ABORTED__');
        // Verifică dacă suntem într-un burst rapid
        const inBurst = Math.random() < opts.burstProbability;
        const burstEnd = inBurst
            ? Math.min(i + opts.burstLength, text.length)
            : i + 1;
        const chunk = text.slice(i, burstEnd);
        i = burstEnd;
        if (inBurst) {
            // Burst: delay foarte mic între caractere
            await typeChunk(page, chunk, randInt(2, 8));
            await sleep(randInt(2, 8));
        }
        else {
            // Delay normal între caractere
            await typeChunk(page, chunk, randInt(opts.minDelay, opts.maxDelay));
        }
        // Pauză după punctuație
        const lastChar = text[i - 1];
        if (lastChar && /[.!?,;:]/.test(lastChar)) {
            await sleep(opts.punctuationPause + randInt(0, 100));
        }
        // Pauză ocazională mai lungă (ca și cum te gândești)
        if (Math.random() < 0.05) {
            await sleep(randInt(200, 500));
        }
    }
}
/** Ultima poziție cunoscută a cursorului (Playwright nu o expune). */
let mousePos = null;
/** Poziție aleatorie în interiorul unui element, sau null dacă nu are casetă. */
async function randomPointIn(page, target) {
    const el = typeof target === 'string' ? page.locator(target).first() : target.first();
    try {
        await el.scrollIntoViewIfNeeded({ timeout: 2000 });
    }
    catch {
        /* elementul poate fi deja vizibil — continuăm oricum */
    }
    const box = await el.boundingBox();
    if (!box)
        return null;
    return {
        x: box.x + box.width * (0.3 + Math.random() * 0.4),
        y: box.y + box.height * (0.3 + Math.random() * 0.4)
    };
}
/**
 * Mișcă mouse-ul în 2-4 pași scurți, pornind din poziția curentă a cursorului
 * (nu din colțul ecranului — altfel prima mișcare ar fi un salt vizibil).
 */
async function moveMouseInSteps(page, x, y) {
    const from = mousePos;
    if (!from) {
        await page.mouse.move(x, y);
        mousePos = { x, y };
        return;
    }
    const steps = randInt(2, 4);
    for (let i = 1; i <= steps; i++) {
        const stepX = from.x + (x - from.x) * (i / steps);
        const stepY = from.y + (y - from.y) * (i / steps);
        await page.mouse.move(stepX, stepY);
        mousePos = { x: stepX, y: stepY };
        await sleep(randInt(5, 20));
    }
}
/**
 * Mișcă mouse-ul ușor înainte de a da click (anti-detect).
 * `target`: selector CSS (string) sau un Locator existent.
 */
async function humanMoveToElement(page, target) {
    try {
        const point = await randomPointIn(page, target);
        if (!point)
            return;
        await moveMouseInSteps(page, point.x, point.y);
    }
    catch (e) {
        log('humanMoveToElement failed: ' + (e?.message ?? String(e)));
        // Fallback: click direct (fără mișcare de mouse)
    }
}
/**
 * v2.0.6: click „uman” — mișcare în pași, `mouse.down()`, o pauză scurtă de
 * 50-150ms cât butonul e apăsat, apoi `mouse.up()`. Întoarce `false` dacă
 * elementul nu are casetă (absent/ascuns), ca apelantul să poată face fallback
 * la click-ul normal al Playwright.
 */
async function humanClick(page, target) {
    try {
        const point = await randomPointIn(page, target);
        if (!point)
            return false;
        await moveMouseInSteps(page, point.x, point.y);
        await page.mouse.down();
        await sleep(randInt(50, 150));
        await page.mouse.up();
        return true;
    }
    catch (e) {
        log('humanClick failed: ' + (e?.message ?? String(e)));
        return false;
    }
}
/** v2.0.6: click cu fallback — folosit de provideri în locul lui `.click()`. */
async function humanClickButton(page, target, timeoutMs = 2000) {
    if ((0, exports.humanBehaviorEnabled)() && (await humanClick(page, target)))
        return;
    await target.click({ timeout: timeoutMs });
}
/**
 * Scroll ușor aleatoriu (ca și cum utilizatorul verifică pagina).
 */
async function humanScroll(page) {
    try {
        const scrollY = randInt(-50, 100);
        await page.evaluate((delta) => {
            window.scrollBy({ top: delta, behavior: 'smooth' });
        }, scrollY);
        await sleep(randInt(100, 300));
    }
    catch {
        /* ignore */
    }
}
// v0.8.1: observer = false (Chrome offscreen suspendă JS-ul → MutationObserver flaky;
// polling-ul clasic la 500ms e fiabil — vezi base.ts).
const DEFAULT_SETTINGS = { typing: true, behavior: true, observer: false };
function humanSettings() {
    try {
        const v = require('vscode');
        const cfg = v.workspace.getConfiguration('freekit');
        return {
            typing: cfg.get('humanTyping', true),
            behavior: cfg.get('humanBehavior', true),
            observer: cfg.get('mutationObserver', false)
        };
    }
    catch {
        return { ...DEFAULT_SETTINGS };
    }
}
const humanTypingEnabled = () => humanSettings().typing;
exports.humanTypingEnabled = humanTypingEnabled;
const humanBehaviorEnabled = () => humanSettings().behavior;
exports.humanBehaviorEnabled = humanBehaviorEnabled;
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
//# sourceMappingURL=human-behavior.js.map