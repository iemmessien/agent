"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BROWSER_AI_TIMEOUT_MS = exports.BROWSER_AI_URL = exports.BROWSER_AI_PROVIDER = void 0;
exports.setBrowserAiPageFactory = setBrowserAiPageFactory;
exports.browserAiAvailable = browserAiAvailable;
exports.askBrowserAi = askBrowserAi;
const log_1 = require("./log");
const log = (msg) => (0, log_1.logLine)('ai-finder', msg);
let pageFactory = null;
/** Înregistrează fabrica de tab-uri (null = modul browser nu e disponibil). */
function setBrowserAiPageFactory(fn) {
    pageFactory = fn;
}
/** true dacă modul browser are pe ce rula (un Chrome conectabil). */
function browserAiAvailable() {
    return pageFactory !== null;
}
/** Web chat-ul folosit implicit de AI Finder (fără API key). */
exports.BROWSER_AI_PROVIDER = 'chatgpt';
exports.BROWSER_AI_URL = 'https://chatgpt.com/';
/** Timeout total al unei analize în browser (FIX 2: 45s). */
exports.BROWSER_AI_TIMEOUT_MS = 45_000;
/** Composerul web chat-ului (ChatGPT: #prompt-textarea e un div contenteditable). */
const COMPOSER_SELECTORS = [
    '#prompt-textarea',
    '[data-testid="prompt-textarea"]',
    'div[contenteditable="true"]',
    'textarea'
];
/** Bula asistentului. */
const REPLY_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-testid^="conversation-turn"] .markdown',
    '.markdown'
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Primul element vizibil/activ dintr-o listă de selectori. */
async function firstUsable(page, selectors) {
    for (const sel of selectors) {
        try {
            const loc = page.locator(sel).first();
            if ((await loc.count()) === 0)
                continue;
            if (!(await loc.isVisible().catch(() => false)))
                continue;
            return loc;
        }
        catch {
            /* selector invalid — încercăm următorul */
        }
    }
    return null;
}
async function waitForComposer(page, deadline, signal) {
    // fără composer în ~8s pagina e de login/CAPTCHA — nu așteptăm tot bugetul
    const giveUpAt = Math.min(deadline, Date.now() + 8_000);
    while (Date.now() < giveUpAt) {
        if (signal?.aborted)
            return null;
        const composer = await firstUsable(page, COMPOSER_SELECTORS);
        if (composer && (await composer.isEnabled().catch(() => false)))
            return composer;
        await sleep(500);
    }
    return null;
}
/** Trimite promptul: Enter (standardul ChatGPT) sau butonul de send. */
async function submitPrompt(page) {
    const send = await firstUsable(page, [
        '[data-testid="send-button"]',
        'button[aria-label*="Send" i]',
        'button[data-testid*="send" i]'
    ]);
    if (send && (await send.isEnabled().catch(() => false))) {
        await send.click().catch(() => undefined);
        return;
    }
    await page.keyboard.press('Enter');
}
/** Cea mai lungă bulă de asistent de până acum (textul rulează în timp). */
async function readReply(page) {
    try {
        return await page.evaluate((sels) => {
            let best = '';
            for (const sel of sels) {
                let nodes;
                try {
                    nodes = document.querySelectorAll(sel);
                }
                catch {
                    continue;
                }
                for (let i = 0; i < nodes.length; i++) {
                    const text = (nodes[i].innerText || '').trim();
                    if (text.length > best.length)
                        best = text;
                }
            }
            return best;
        }, REPLY_SELECTORS);
    }
    catch {
        return '';
    }
}
async function waitForReply(page, deadline, signal) {
    let last = '';
    let stable = 0;
    while (Date.now() < deadline) {
        if (signal?.aborted)
            return '';
        const text = await readReply(page);
        if (text && text === last) {
            stable++;
            // stabil ~1.5s = generarea s-a terminat (promptul cere DOAR JSON)
            if (stable >= 3)
                return text;
        }
        else {
            stable = 0;
            last = text;
        }
        await sleep(500);
    }
    return last;
}
/**
 * Trimite promptul unui web chat într-un TAB NOU și întoarce răspunsul (sau
 * null). Nu aruncă niciodată: orice eroare/timeout se loghează și întoarce null.
 */
async function askBrowserAi(prompt, opts = {}) {
    if (!pageFactory) {
        log('mode=browser unavailable — no browser page factory registered');
        return null;
    }
    const timeoutMs = Math.max(5_000, opts.timeoutMs ?? exports.BROWSER_AI_TIMEOUT_MS);
    const deadline = Date.now() + timeoutMs;
    let page = null;
    try {
        page = await pageFactory();
        if (!page || opts.signal?.aborted)
            return null;
        log('provider=' + exports.BROWSER_AI_PROVIDER + ': new tab open — asking ' + exports.BROWSER_AI_URL);
        await page.goto(exports.BROWSER_AI_URL, {
            waitUntil: 'domcontentloaded',
            timeout: Math.min(20_000, timeoutMs)
        });
        const composer = await waitForComposer(page, deadline, opts.signal);
        if (!composer) {
            log('provider=' + exports.BROWSER_AI_PROVIDER + ': no chat composer (login required?)');
            return null;
        }
        await composer.click().catch(() => undefined);
        await page.keyboard.insertText(prompt);
        await sleep(150);
        await submitPrompt(page);
        const reply = await waitForReply(page, deadline, opts.signal);
        if (!reply) {
            log('provider=' + exports.BROWSER_AI_PROVIDER + ': no reply within ' +
                Math.round(timeoutMs / 1000) + 's');
            return null;
        }
        log('provider=' + exports.BROWSER_AI_PROVIDER + ': reply received (' + reply.length + ' chars)');
        return reply;
    }
    catch (e) {
        log('browser mode failed: ' + (e?.message ?? String(e)));
        return null;
    }
    finally {
        if (page) {
            await page
                .close()
                .then(() => log('provider=' + exports.BROWSER_AI_PROVIDER + ': tab closed'))
                .catch((e) => log('closing the AI finder tab failed: ' + (e?.message ?? String(e))));
        }
    }
}
//# sourceMappingURL=browserAi.js.map