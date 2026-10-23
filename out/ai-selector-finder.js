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
exports.BACKUP_MAX_VERSIONS = exports.BACKUP_KEEP = exports.USER_LOCK_PROVIDERS = exports.RESPONSE_FALLBACK_SELECTORS = exports.RESPONSE_PARENT_TEXT_RATIO = exports.RESPONSE_TOOL_MARKERS = exports.RESPONSE_MIN_CHARS = exports.AI_FINDER_DEFAULT_MODE = exports.MAX_INPUT_REPAIR_FAILURES = exports.MAX_PROACTIVE_ATTEMPTS = exports.DEFAULT_AI_FINDER_TIMEOUT_SECONDS = exports.INTERACTIVE_FILTER = exports.AI_FINDER_MAX_ATTEMPTS = exports.DOM_MAX_CHARS = void 0;
exports.resolveAiFinderModel = resolveAiFinderModel;
exports.acceptsTextInput = acceptsTextInput;
exports.checkInputCandidate = checkInputCandidate;
exports.formatCandidateLine = formatCandidateLine;
exports.captureCleanDom = captureCleanDom;
exports.buildPrompt = buildPrompt;
exports.extractSelectorFromProxyResponse = extractSelectorFromProxyResponse;
exports.parseAIResponse = parseAIResponse;
exports.getAIFinderCancellationCount = getAIFinderCancellationCount;
exports.cancelAIFinder = cancelAIFinder;
exports.findSelectorsWithAI = findSelectorsWithAI;
exports.validateChatInputSelector = validateChatInputSelector;
exports.validateResponseSelector = validateResponseSelector;
exports.functionallyValidateSlot = functionallyValidateSlot;
exports.validateSelectors = validateSelectors;
exports.userSelectorsFilePath = userSelectorsFilePath;
exports.userBackupFilePath = userBackupFilePath;
exports.backupTimestampedUserSelectors = backupTimestampedUserSelectors;
exports.restoreFromBackup = restoreFromBackup;
exports.saveUserSelectors = saveUserSelectors;
exports.resetAIFinderCache = resetAIFinderCache;
exports.noteProviderNotReady = noteProviderNotReady;
exports.discoveryDateFor = discoveryDateFor;
exports.resetDiscoveryState = resetDiscoveryState;
exports.proactiveDiscover = proactiveDiscover;
exports.repairChatInput = repairChatInput;
exports.rediscoverSelectors = rediscoverSelectors;
exports.unlockBrokenUserSelectors = unlockBrokenUserSelectors;
exports.resetUserLockFailures = resetUserLockFailures;
exports.initAISelectorFinder = initAISelectorFinder;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const log_1 = require("./log");
const ollama_1 = require("./providers/ollama");
const providers_1 = require("./providers");
const aiFinderModel_1 = require("./aiFinderModel");
const hardware_1 = require("./hardware");
const ai_finder_events_1 = require("./ai-finder-events");
const selectors_1 = require("./selectors");
const browserAi_1 = require("./browserAi");
const proxyAi_1 = require("./proxyAi");
const log = (msg) => (0, log_1.logLine)('ai-finder', msg);
/** v2.5.44 (bug #101): același tag ca healer-ul din selectors.ts. */
const healLog = (msg) => (0, log_1.logLine)('healer', msg);
/** v2.5.61: tag pentru cascada de reparare (FIX 7), ca să fie ușor de filtrat. */
const tierLog = (msg) => (0, log_1.logLine)('selectors', msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Butoanele de „acțiune” nu sunt niciodată newChat/stop (gardă simplă). */
const NON_ACTION_RE = /(^|[^a-z])(sign|signin|sign-in|signup|sign-up|login|log-in|logout|upgrade|premium|invite|subscribe|purchase|checkout|download)([^a-z]|$)/i;
/**
 * Limita de caractere a snapshot-ului. Ollama rulează implicit cu
 * num_ctx 8192 (vezi providers/ollama.ts), deci păstrăm DOM-ul sub ~7k
 * tokeni: head + tail (zonele utile sunt de obicei capul și coada paginii).
 *
 * v2.5.41 (bug #96): lista candidaților interacți are prioritate în acest
 * buget; doar DOM-ul filtrat de după ea se trunchiază (head + tail).
 */
exports.DOM_MAX_CHARS = 18000;
/**
 * v2.5.41 (bug #95): câte încercări de analiză facem pentru un set de sloturi.
 * Prima are promptul normal; următoarele primesc în plus motivul respingerii
 * („prompt mai specific"), ca modelul să nu propună din nou același element.
 */
exports.AI_FINDER_MAX_ATTEMPTS = 2;
const AI_FINDER_ATTEMPT_TIMEOUT_MS = 30_000;
const AI_FINDER_GLOBAL_TIMEOUT_MS = 60_000;
/**
 * v2.5.61 (FIX 2): modul browser e single-shot (45s pentru răspuns + validarea
 * în pagină a selectorilor propuși), deci plafonul global e mai mare.
 */
const AI_FINDER_BROWSER_GLOBAL_TIMEOUT_MS = 75_000;
/** Proxy-ul are 30s, cu până la 45s suplimentare pentru fallback-ul browser. */
const AI_FINDER_PROXY_GLOBAL_TIMEOUT_MS = 75_000;
/**
 * v2.5.41 (bug #96): ce ajunge în snapshot. HTML-ul complet al unui chat
 * înseamnă mii de div-uri — modelul local se pierde în ele și alege exact ce
 * nu trebuie (ex: inputul ascuns `aria-label="Line wrap"` din ChatGPT). Trimitem
 * doar elementele interactive, plus strămoșii lor (ca modelul să poată compune
 * selectorul); butoanele rămân incluse, altfel sloturile newChat/stopButton ar
 * rămâne fără nicio informație. Textul conversației se adaugă separat, doar când
 * căutăm containerul de răspuns (acolo e chiar informația utilă).
 */
exports.INTERACTIVE_FILTER = [
    'textarea',
    'input',
    'button',
    '[role="button"]',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[aria-label*="message" i]',
    '[aria-label*="chat" i]',
    '[aria-label*="prompt" i]',
    '[aria-label*="input" i]',
    // v2.5.75 (FIX 3): butonul „New chat" al Claude e un LINK din sidebar
    // (<a href="/new">) — fără ancorele din nav/aside/header (v2.5.75 FIX 1:
    // „Claude nu are selector stabil pentru butonul New chat"), AI Finder-ul nu-l
    // vedea deloc în snapshot.
    'nav a[href]',
    'aside a[href]',
    'header a[href]',
    '[role="navigation"] a[href]',
    '[role="complementary"] a[href]'
].join(', ');
/** Câți candidați interacți încăpem în prompt (restul e zgomot). */
const MAX_SNAPSHOT_CANDIDATES = 25;
/** Un nod de text mai scurt de atât nu ajută la găsirea răspunsului. */
const MIN_TEXT_CHARS = 40;
/**
 * Timeout per încercare, plafonat suplimentar de timeout-ul global de 60s.
 */
exports.DEFAULT_AI_FINDER_TIMEOUT_SECONDS = 30;
const AI_RETRY_MS = 5 * 60 * 1000;
/* Manual full discovery is explicitly requested through Repair Selectors. */
/** Fix 5 (bug #102): cât timp considerăm o descoperire „proaspătă". */
const DISCOVERY_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
/** Fix 1 (bug #102): selectorii bundled mai vechi de atât ⇒ descoperire nouă. */
const DISCOVERY_STALE_MS = 30 * 24 * 60 * 60 * 1000;
/** Fix 2 (bug #102): cel mult atâtea descoperiri proactive per sesiune/provider. */
exports.MAX_PROACTIVE_ATTEMPTS = 3;
/** Fix 3 (bug #102): atâtea reparații de input ratate înainte de cardul din chat. */
exports.MAX_INPUT_REPAIR_FAILURES = 3;
/** Fix 5: data ultimei descoperiri per provider (persistată în `_meta.discoveryDate`). */
const discoveryDates = new Map();
/** Fix 1: ultima verificare a eșuat → descoperirea se reia fără să aștepte cache-ul. */
const discoveryFailed = new Set();
/** Fix 2: provider cu descoperire amânată (login/CAPTCHA/input lipsă) → reîncercare. */
const pendingDiscovery = new Map();
/** Fix 2: câte descoperiri chiar au rulat în sesiunea curentă, per provider. */
const proactiveAttempts = new Map();
/** Fix 3: câte reparații de input au eșuat în sesiunea curentă, per provider. */
const inputRepairFailures = new Map();
/** Fix 3: cardul „fix manual" se afișează o singură dată per sesiune. */
const inputRepairGaveUp = new Set();
const AI_FINDER_MODES = ['off', 'ollama', 'browser', 'api-proxy'];
exports.AI_FINDER_DEFAULT_MODE = 'api-proxy';
/** v2.5.61 (FIX 2): citește `freekit.aiSelectorFinder.mode`. */
function aiFinderMode() {
    try {
        // require lazy — în teste Node modulul 'vscode' poate lipsi
        const v = require('vscode');
        const raw = String(v.workspace
            .getConfiguration('freekit')
            .get('aiSelectorFinder.mode', exports.AI_FINDER_DEFAULT_MODE) ?? '')
            .trim()
            .toLowerCase();
        return AI_FINDER_MODES.includes(raw)
            ? raw
            : exports.AI_FINDER_DEFAULT_MODE;
    }
    catch {
        return exports.AI_FINDER_DEFAULT_MODE;
    }
}
function finderSettings() {
    const mode = aiFinderMode();
    try {
        const v = require('vscode');
        const secs = Number(v.workspace
            .getConfiguration('freekit')
            .get('aiFinderTimeoutSeconds', exports.DEFAULT_AI_FINDER_TIMEOUT_SECONDS));
        const safe = Number.isFinite(secs)
            ? Math.min(30, Math.max(5, secs))
            : exports.DEFAULT_AI_FINDER_TIMEOUT_SECONDS;
        return { mode, enabled: mode !== 'off', timeoutMs: safe * 1000 };
    }
    catch {
        return {
            mode,
            enabled: mode !== 'off',
            timeoutMs: exports.DEFAULT_AI_FINDER_TIMEOUT_SECONDS * 1000
        };
    }
}
/* ------------------- modelul Ollama pentru AI finder ------------------- */
/** v2.5.40 (bug #93): valoarea setării `freekit.aiFinderModel`. */
function aiFinderModelSetting() {
    try {
        const v = require('vscode');
        const raw = v.workspace
            .getConfiguration('freekit')
            .get('aiFinderModel', aiFinderModel_1.AI_FINDER_MODEL_AUTO);
        return String(raw ?? '').trim();
    }
    catch {
        return aiFinderModel_1.AI_FINDER_MODEL_AUTO;
    }
}
/**
 * v2.5.40 (bug #93) — rezolvă modelul folosit de AI selector finder.
 *
 * Înainte finder-ul folosea `freekit.ollamaModel`; dacă acolo era un model
 * neinstalat (ex. `gemma3:12b`), analiza nu mai pornea deloc deși pe mașină
 * existau modele utilizabile. Acum:
 *   - `auto` (implicit) → `gemma3:12b` dacă e instalat, altfel primul model de
 *     chat după preferință (qwen2.5-coder > qwen-coder > qwen > llama >
 *     mistral > orice altul), embeddings excluse;
 *   - model explicit instalat → îl folosim;
 *   - model explicit lipsă, sau doar embeddings instalate → warning clar în log
 *     și `null` (fail-open, ca înainte, dar fără eroarea înșelătoare de 404).
 */
async function resolveAiFinderModel() {
    const requested = aiFinderModelSetting();
    const installed = (await (0, ollama_1.listOllamaModelsDetailed)()).map((m) => m.name);
    if (!(0, aiFinderModel_1.isAutoAiFinderModel)(requested)) {
        // Lista goală = Ollama oprit: lăsăm providerul să dea eroarea lui tipizată
        // („Ollama down"), nu una de model lipsă.
        if (installed.length && !installed.includes(requested)) {
            log('model "' +
                requested +
                '" (freekit.aiFinderModel) is not installed — installed: ' +
                installed.join(', '));
            return null;
        }
        log('using model ' + requested + ' (freekit.aiFinderModel)');
        return requested;
    }
    const choice = (0, aiFinderModel_1.pickAiFinderModel)(installed);
    if (!choice) {
        const embeddings = installed.filter((m) => (0, hardware_1.isEmbeddingModel)(m));
        log('no chat model available for the AI analysis' +
            (embeddings.length
                ? ' — only embeddings installed: ' + embeddings.join(', ')
                : ' — installed: ' + (installed.join(', ') || 'none')) +
            '; install one (e.g. `ollama pull qwen2.5-coder:7b`) or set freekit.aiFinderModel');
        return null;
    }
    log('using model ' + choice.model + ' (' + choice.reason + ')');
    return choice.model;
}
/** Tipurile de <input> care acceptă text ('' = atribut lipsă → text implicit). */
const TEXT_INPUT_TYPES = ['text', 'search', ''];
/** Editori bogați (Claude/Gemini etc.): rădăcina lor nu are contenteditable. */
const EDITOR_CLASS_RE = /ProseMirror|ql-editor|contenteditable/i;
/**
 * v2.5.41 (bug #95): „acceptă text" — singura definiție a căsuței de chat,
 * folosită și la pre-filtrarea DOM-ului (bug #96) și la validarea strictă.
 */
function acceptsTextInput(p) {
    const tag = String(p.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA')
        return true;
    if (tag === 'INPUT')
        return TEXT_INPUT_TYPES.indexOf(p.type) >= 0;
    if (p.contenteditable === 'true' || p.isContentEditable === true)
        return true;
    return EDITOR_CLASS_RE.test(p.className || '');
}
/**
 * v2.5.41 (bug #95): toate criteriile unui candidat de căsuță de chat. La
 * rulare e folosit întotdeauna PRIMUL element al selectorului (vezi
 * resolveSlot), deci exact primul element trebuie să treacă de toate.
 */
function checkInputCandidate(p, viewport) {
    const r = p.rect;
    const visible = r.width >= 6 &&
        r.height >= 6 &&
        p.display !== 'none' &&
        p.visibility !== 'hidden' &&
        Number(p.opacity) > 0;
    const enabled = !p.disabled && !p.ariaDisabled;
    const acceptsText = acceptsTextInput(p);
    const inViewport = r.y + r.height > 0 && r.y < viewport.height && r.x + r.width > 0 && r.x < viewport.width;
    // căsuța de chat e „lipită" de marginea de jos a paginii
    const nearBottom = r.y > viewport.height * 0.5;
    // v2.5.74 (FIX 2): criteriile de bază — există, e vizibil, e activ, acceptă
    // text, e în viewport. „Near bottom" NU mai respinge candidatul: pe Gemini
    // căsuța stă într-un layout care nu o lasă în jumătatea de jos, iar vechea
    // regulă respingea selectorul corect (`textarea[placeholder="Ask Gemini"]`).
    // Rămâne doar un AVERTISMENT (câmpul `nearBottom`, afișat în snapshot).
    let reason;
    if (!visible)
        reason = 'not visible';
    else if (!enabled)
        reason = 'disabled';
    else if (!acceptsText)
        reason = 'does not accept text';
    else if (!inViewport)
        reason = 'outside the viewport';
    return { visible, enabled, acceptsText, inViewport, nearBottom, ok: !reason, reason };
}
/** Linia din snapshot pe care o citește modelul pentru un candidat (bug #96). */
function formatCandidateLine(n, p, viewport) {
    const c = checkInputCandidate(p, viewport);
    const yn = (b) => (b ? 'yes' : 'no');
    return ('#' +
        n +
        ' <' +
        String(p.tagName || '').toLowerCase() +
        '> ' +
        (p.attrs || '(fără atribute)') +
        ' | visible=' +
        yn(c.visible) +
        ' enabled=' +
        yn(c.enabled) +
        ' acceptsText=' +
        yn(c.acceptsText) +
        ' inViewport=' +
        yn(c.inViewport) +
        ' y=' +
        Math.round(p.rect.y) +
        ' x=' +
        Math.round(p.rect.x) +
        ' w=' +
        Math.round(p.rect.width) +
        ' h=' +
        Math.round(p.rect.height));
}
/** Citește din pagină datele brute ale elementelor care potrivesc un selector. */
async function probeInputCandidates(page, selector, limit = MAX_SNAPSHOT_CANDIDATES) {
    return page.evaluate((args) => {
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        let nodes;
        try {
            nodes = document.querySelectorAll(args.selector);
        }
        catch {
            return { count: -1, viewport, probes: [] };
        }
        const attrKeys = [
            'id',
            'name',
            'type',
            'role',
            // v2.5.75 (FIX 3): href-ul e atributul stabil al linkurilor din sidebar
            // (Claude „New chat" → a[href="/new"])
            'href',
            'aria-label',
            'placeholder',
            'data-testid',
            'contenteditable'
        ];
        const probes = [];
        for (let i = 0; i < nodes.length && probes.length < args.limit; i++) {
            const el = nodes[i];
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const cls = typeof el.className === 'string' ? el.className : '';
            const attrs = [];
            for (const key of attrKeys) {
                const v = el.getAttribute(key);
                if (v)
                    attrs.push(key + '="' + String(v).slice(0, 80) + '"');
            }
            if (cls)
                attrs.push('class="' + cls.slice(0, 120) + '"');
            probes.push({
                tagName: el.tagName,
                type: (el.getAttribute('type') || '').toLowerCase(),
                role: el.getAttribute('role') || '',
                contenteditable: el.getAttribute('contenteditable') || '',
                isContentEditable: el.isContentEditable === true,
                className: cls,
                disabled: el.disabled === true,
                ariaDisabled: el.getAttribute('aria-disabled') === 'true',
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
                attrs: attrs.join(' ')
            });
        }
        return { count: nodes.length, viewport, probes };
    }, { selector, limit });
}
/**
 * HTML-ul curățat: doar candidații interacți (plus strămoșii lor, ca selectorul
 * să poată fi compus) și — opțional — nodurile cu text. Cu `skipFilter` întoarce
 * tot DOM-ul curățat (comportamentul dinainte de v2.5.41, folosit de raportarea
 * de bug).
 */
async function captureFilteredHtml(page, opts) {
    return page.evaluate((cfg) => {
        const body = document.body;
        if (!body)
            return '(fără body)';
        const noiseTags = [
            'SCRIPT',
            'STYLE',
            'NOSCRIPT',
            'IFRAME',
            'SVG',
            'LINK',
            'META',
            'TEMPLATE',
            'CANVAS',
            'VIDEO',
            'AUDIO'
        ];
        const noiseClassRe = /cookie|gdpr|consent|advert/i;
        const clone = body.cloneNode(true);
        // cloneNode păstrează ordinea: indexul din `keep` e valabil pentru ambele
        // liste (clonatul e încă intact, nu am șters nimic)
        const live = Array.from(body.querySelectorAll('*'));
        const cloned = Array.from(clone.querySelectorAll('*'));
        const index = new Map();
        for (let i = 0; i < live.length; i++)
            index.set(live[i], i);
        const keep = new Uint8Array(live.length);
        const mark = (el) => {
            let node = el;
            while (node && node !== body) {
                const i = index.get(node);
                if (i === undefined || keep[i])
                    return;
                keep[i] = 1;
                node = node.parentElement;
            }
        };
        if (!cfg.skipFilter) {
            for (let i = 0; i < live.length; i++) {
                const el = live[i];
                if (noiseTags.indexOf(el.tagName) >= 0)
                    continue;
                if (noiseClassRe.test(el.getAttribute('class') || ''))
                    continue;
                let interactive = false;
                try {
                    interactive = el.matches(cfg.filter);
                }
                catch {
                    interactive = false;
                }
                if (interactive)
                    mark(el);
            }
            if (cfg.includeText) {
                const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
                let t = walker.nextNode();
                while (t) {
                    const parent = t.parentElement;
                    if ((t.nodeValue || '').trim().length >= cfg.minText &&
                        parent &&
                        noiseTags.indexOf(parent.tagName) < 0) {
                        mark(parent);
                    }
                    t = walker.nextNode();
                }
            }
        }
        // zgomot: scripturi, stiluri, media, cookie/GDPR/ads
        clone
            .querySelectorAll('script, style, noscript, iframe, svg, link, meta, template, canvas, video, audio, [class*="cookie"], [class*="gdpr"], [class*="consent"], [class*="advert"]')
            .forEach((el) => el.remove());
        // atribute irelevante (style, on*, data-react*, payload-uri de imagine)
        clone.querySelectorAll('*').forEach((el) => {
            const attrs = Array.from(el.attributes);
            for (const attr of attrs) {
                const n = attr.name;
                if (n === 'style' ||
                    n.startsWith('on') ||
                    n.startsWith('data-react') ||
                    n === 'srcset' ||
                    n === 'sizes') {
                    el.removeAttribute(n);
                }
            }
        });
        // valorile din input pot conține date sensibile (parole etc.)
        clone.querySelectorAll('input, textarea').forEach((el) => el.removeAttribute('value'));
        // v2.5.41 (bug #96): aruncăm tot ce nu e candidat sau strămoș al unuia —
        // de la coadă spre cap (un nod fără descendenți păstrați nu are ce șterge)
        if (!cfg.skipFilter) {
            for (let i = cloned.length - 1; i >= 0; i--) {
                if (!keep[i])
                    cloned[i].remove();
            }
        }
        return clone.outerHTML;
    }, {
        filter: exports.INTERACTIVE_FILTER,
        includeText: opts.includeText,
        minText: MIN_TEXT_CHARS,
        skipFilter: opts.skipFilter === true
    });
}
/** Marcajul de trunchiere (ține lungimea sub buget, vezi truncateHtml). */
const TRUNC_MARK = '\n...[truncat]...\n';
/** Head + tail, ca înainte: zonele utile sunt capul și coada paginii. */
function truncateHtml(html, max) {
    if (html.length <= max)
        return html;
    const half = Math.floor(Math.max(0, max - TRUNC_MARK.length) / 2);
    return html.slice(0, half) + TRUNC_MARK + html.slice(-half);
}
/**
 * Snapshot-ul trimis modelului (bug #96): lista candidaților interacți, cu
 * vizibilitatea/poziția deja calculate (ca modelul să nu ghicească), urmată de
 * DOM-ul filtrat (candidații și strămoșii lor). Lista are prioritate la
 * trunchiere, ca să nu rămână modelul fără elementele în care trebuie să aleagă.
 */
async function captureCleanDom(page, opts = {}) {
    if (opts.full) {
        return truncateHtml(await captureFilteredHtml(page, { includeText: true, skipFilter: true }), exports.DOM_MAX_CHARS);
    }
    const includeText = opts.includeText !== false;
    const snapshot = await probeInputCandidates(page, exports.INTERACTIVE_FILTER);
    const html = await captureFilteredHtml(page, { includeText });
    const lines = snapshot.probes.map((p, i) => formatCandidateLine(i + 1, p, snapshot.viewport));
    if (snapshot.count > snapshot.probes.length) {
        lines.push('... +' + (snapshot.count - snapshot.probes.length) + ' more interactive elements');
    }
    const candidates = 'VIEWPORT: ' +
        Math.round(snapshot.viewport.width) +
        'x' +
        Math.round(snapshot.viewport.height) +
        '\nINTERACTIVE CANDIDATES (' +
        Math.max(0, snapshot.count) +
        ', in DOM order):\n' +
        (lines.join('\n') || '(none)');
    // v2.5.75 (FIX 3): pentru `newChat` trimitem EXPLICIT sidebar-ul/navul — la
    // Claude butonul e un link (<a href="/new">) ascuns între zeci de linkuri de
    // conversații, iar modelul îl rata. Lista de mai jos e scurtă și conține doar
    // linkuri/botoane din nav/aside/header, cu selectorul stabil sugerat.
    let sidebar = '';
    if (opts.sidebarHints) {
        try {
            const hints = await page.evaluate(() => {
                const out = [];
                const nodes = Array.prototype.slice.call(document.querySelectorAll('nav a[href], aside a[href], header a[href], [role="navigation"] a[href], ' +
                    'nav button, aside button, header button'));
                for (const el of nodes) {
                    if (out.length >= 12)
                        break;
                    const r = el.getBoundingClientRect();
                    if (r.width < 8 || r.height < 8)
                        continue;
                    const tag = el.tagName.toLowerCase();
                    const href = el.getAttribute('href') || '';
                    const aria = el.getAttribute('aria-label') || '';
                    const testid = el.getAttribute('data-testid') || '';
                    const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
                    const suggestions = [];
                    if (href && href.length <= 120)
                        suggestions.push(tag + '[href="' + href + '"]');
                    if (aria)
                        suggestions.push(tag + '[aria-label="' + aria + '"]');
                    if (testid)
                        suggestions.push(tag + '[data-testid="' + testid + '"]');
                    if (!suggestions.length)
                        continue;
                    out.push('-' + tag + (href ? ' href="' + href.slice(0, 60) + '"' : '') +
                        (aria ? ' aria-label="' + aria.slice(0, 60) + '"' : '') +
                        (text ? ' text="' + text.slice(0, 60) + '"' : '') +
                        ' => ' + suggestions.join(' | '));
                }
                return out;
            });
            if (hints.length) {
                sidebar =
                    '\n\nSIDEBAR / NAV LINKS (navigation chrome, in DOM order — the "new chat" ' +
                        'button of a SPA is usually one of these):\n' + hints.join('\n');
            }
        }
        catch {
            /* fără hint-uri — promptul rămâne cel normal */
        }
    }
    const budget = Math.max(2000, exports.DOM_MAX_CHARS - candidates.length - sidebar.length);
    let out = candidates +
        sidebar +
        '\n\nFILTERED DOM (only those candidates, their ancestors' +
        (includeText ? ' and text blocks' : '') +
        '; noise removed):\n' +
        truncateHtml(html, budget);
    if (out.length > exports.DOM_MAX_CHARS) {
        out = out.slice(0, exports.DOM_MAX_CHARS - TRUNC_MARK.length) + TRUNC_MARK;
    }
    return out;
}
/**
 * v2.5.41 (bug #96): promptul spune exact ce e căsuța de chat (jos, vizibilă,
 * activă, acceptă text), cum se citește lista de candidați și ce NU are voie să
 * aleagă (inputuri ascunse, upload, căutare, „Line wrap" etc.). La reîncercare
 * primește și motivul respingerii, ca să nu repete același element.
 *
 * v2.5.45 (bug #102): `ctx.onboarding` = descoperirea proactivă la conectare
 * (toate sloturile dintr-o trecere), `ctx.inputOnly` = reparația căsuței de chat
 * după un mesaj trunchiat.
 */
function buildPrompt(ctx) {
    const lines = [
        'You are a DOM analysis expert. Find CSS selectors for a website UI.',
        '',
        'WEBSITE: ' + ctx.providerName,
        'URL: ' + ctx.url,
        'I need selectors for these elements: ' + ctx.missingSlots.join(', '),
        ''
    ];
    if (ctx.onboarding) {
        lines.push('ONBOARDING: you are wiring up a NEW AI chat provider — find ALL the selectors listed', 'above in ONE pass.', '');
    }
    lines.push('Element meanings:', '- input: THE CHAT INPUT — the text box where the user types a message. It sits in the', "  BOTTOM HALF of the page and it is VISIBLE, ENABLED and accepts typed text: a <textarea>,", '  an <input type="text">/<input type="search">, a <div contenteditable="true"> (often with', '  class ProseMirror or ql-editor) or an element with role="textbox".', "- response: the container holding the AI assistant's LATEST reply (NOT the user's message bubble, NOT the input box, NOT promo/marketing cards).", '  It must be the WHOLE reply: reading that element has to return the full reply text — every', '  paragraph, every code fence and any `ACTION:` / `TOOL:` block it contains. A fragment of the', '  reply, an inner "thinking"/"reasoning" block or a single paragraph is WRONG.', '- newChat: button to start a new conversation', '- stopButton: button to stop AI generation (visible only while generating)', '', 'HOW TO READ THE SNAPSHOT:', '1. INTERACTIVE CANDIDATES lists the interactive elements of the page (inputs, editors,', '   buttons) in DOM order, with their attributes and with flags already computed for you.', '2. FILTERED DOM shows those elements inside their real ancestor chain — take the selector', '   from there (prefer id, then aria-label/data-testid, then role, then a stable class).', '', 'INSTRUCTIONS:', '1. For "input" pick ONLY a candidate with visible=yes, enabled=yes, acceptsText=yes and', '   inViewport=yes, and prefer the one with the LARGEST y — the composer is at the bottom.', '2. NEVER pick: hidden inputs (type="hidden"), file/upload inputs, off-screen, zero-size or', '   disabled controls, search boxes, theme/spellcheck/"Line wrap" helpers, cookie banners,', '   sidebars, headers, footers or promotional cards.', '3. The selector must match the element in the REAL page (the snapshot comes from it):', '   never invent ids/classes, and do not use the candidate numbering.', '4. Use STABLE selectors: prefer data-testid > id > aria-label > role > semantic tag > class.', '   Use at most 1-2 classes; NEVER :nth-child / :nth-of-type / positional paths.', '5. If an element does not exist in the snapshot, return null for it.');
    if (ctx.missingSlots.indexOf('response') >= 0) {
        lines.push('', 'Find CSS selector for the FINAL assistant reply ONLY.', "EXCLUDE elements with 'thinking', 'reasoning', 'extended-thinking' in class.", 'Must return ONLY the last message text, not internal reasoning.');
    }
    // v2.5.66 (FIX 3): prompt țintit pentru „newChat" — fără el modelul răspundea
    // „null" (alegea butoane de acțiune din mesaje sau nu găsea butonul deloc).
    if (ctx.missingSlots.indexOf('newChat') >= 0) {
        lines.push('', "Find the selector for the 'New chat' button in the sidebar (top-left).", "It's usually <a href='/new'> or <button aria-label*='new chat'>.", "EXCLUDE any element with 'action-bar', 'copy', 'edit', 'delete', 'share' in aria-label/testid.", 'Reply JSON: {"newChat": "..."}');
    }
    if (ctx.attempt > 1 && ctx.failureReason) {
        lines.push('', 'ATTEMPT ' + ctx.attempt + ' OF ' + exports.AI_FINDER_MAX_ATTEMPTS + ' — YOUR PREVIOUS ANSWER WAS REJECTED:', '- rejected selector: ' + (ctx.rejectedSelector || '(none)'), '- why it was rejected: ' + ctx.failureReason);
        if (ctx.missingSlots.indexOf('input') >= 0) {
            lines.push('That element is NOT the chat input. Read INTERACTIVE CANDIDATES again and answer with a', 'DIFFERENT element that satisfies rule 1 (visible=yes, enabled=yes, acceptsText=yes,', 'inViewport=yes, largest y).');
        }
        if (ctx.missingSlots.indexOf('response') >= 0) {
            lines.push('That element does NOT return the whole reply. Answer with the CONTAINER of the latest', 'assistant reply — reading it must give the FULL reply text (all paragraphs, code fences and', 'any ACTION:/TOOL: block), not a fragment and not the inner "thinking" block.');
        }
        lines.push('If no candidate qualifies, return null.');
    }
    if (ctx.inputOnly) {
        lines.push('', 'FOCUS — the message was TRUNCATED in the composer, so the stored input is suspect:', 'Where is the CHAT INPUT (text composer)? It is visible, enabled, accepts text and sits in the', 'BOTTOM half of the screen. Reject hidden, disabled, search and file inputs, and every helper', 'input (spellcheck, "Line wrap", upload). Answer with the composer in "input" and null for the', 'other slots.');
    }
    lines.push('', 'DOM SNAPSHOT:', '```', ctx.dom, '```', '', 'Respond with ONLY one JSON object (no markdown fences, no explanation):', '{', '  "input": "css selector or null",', '  "response": "css selector or null",', '  "newChat": "css selector or null",', '  "stopButton": "css selector or null",', '  "confidence": 0.0,', '  "reasoning": "short explanation"', '}');
    return lines.join('\n');
}
/* -------------------------------------------------------------------------
 * v2.5.73 (FIX 1-3) — PARSER TOLERANT PENTRU RĂSPUNSUL PROXY-ULUI
 *
 * Proxy-ul e OpenAI-compatible: `{ choices: [ { message: { content: "<reply>" } } ] }`,
 * iar `<reply>` e AL DOILEA nivel de JSON (`{"selector":"...","how":"fingerprint"}`).
 * În plus, `content` poate veni dublu serializat (un string JSON care conține
 * JSON-ul real) sau în code fences / cu text înainte și după. Vechiul parser lua
 * tot textul ca atare și, pe un string JSON, scana greșit ghilimelele → „niciun
 * JSON găsit". Acum desfacem cele două niveluri și cădem pe regex.
 * ------------------------------------------------------------------------- */
/**
 * Nivel 1: desface envelope-ul OpenAI și string-urile JSON dublu serializate
 * (max 3 iterații — proxy-ul poate înlănțui serializările).
 */
function unwrapAiReply(reply) {
    let current = String(reply ?? '');
    for (let i = 0; i < 3; i++) {
        const trimmed = current.trim();
        if (!trimmed)
            return current;
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch {
            return current;
        }
        if (typeof parsed === 'string') {
            if (parsed === current)
                return current;
            current = parsed;
            continue;
        }
        if (parsed && typeof parsed === 'object') {
            const content = parsed
                ?.choices?.[0]?.message?.content;
            if (typeof content === 'string' && content !== current) {
                current = content;
                continue;
            }
        }
        return current;
    }
    return current;
}
/**
 * Nivel 2 (FIX 2): parsează tolerant obiectul JSON din textul deja desfăcut —
 * direct, în code fences, cu text înainte/după sau, ultimă variantă, doar
 * perechea `"selector": "..."` (răspuns trunchiat / în proză).
 */
function parseJsonObjectLoose(text) {
    const source = String(text ?? '');
    const fenced = source.replace(/```[a-z]*\s*|```/gi, ' ');
    const attempts = [];
    const balanced = extractJsonObject(source);
    if (balanced)
        attempts.push(balanced);
    const balancedFenced = extractJsonObject(fenced);
    if (balancedFenced && attempts.indexOf(balancedFenced) < 0)
        attempts.push(balancedFenced);
    attempts.push(source, fenced);
    for (const candidate of attempts) {
        const t = candidate.trim();
        if (!t)
            continue;
        try {
            const parsed = JSON.parse(t);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        }
        catch {
            /* încercăm următoarea variantă */
        }
    }
    const m = source.match(/"selector"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m)
        return { selector: m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') };
    return null;
}
/** Nivel 1 + 2 fără log-uri (folosit după ce apelantul a logat deja raw-ul). */
function resolveAiObject(reply) {
    const raw = String(reply ?? '');
    const content = unwrapAiReply(raw);
    return { content, object: parseJsonObjectLoose(content) };
}
/**
 * FIX 3: citește obiectul JSON din răspunsul brut al proxy-ului, cu log-uri la
 * fiecare pas (raw → content → obiect), ca eșecul să fie diagnosticabil.
 */
function readAiJsonObject(reply) {
    const raw = String(reply ?? '');
    log('proxy raw (' + raw.length + ' chars): ' + raw.slice(0, 300));
    const { content, object } = resolveAiObject(raw);
    if (content !== raw) {
        log('proxy content (' + content.length + ' chars): ' + content.slice(0, 300));
    }
    if (!object) {
        log('niciun JSON găsit în răspunsul AI');
        log('proxy parse failed — content dump: ' + JSON.stringify(content.slice(0, 500)));
    }
    return object;
}
/** Forma „un singur selector" a unui obiect extras (fără log-uri). */
function selectorFromObject(object) {
    const selector = typeof object.selector === 'string' ? object.selector.trim() : '';
    if (!selector)
        return null;
    const how = typeof object.how === 'string' && object.how.trim() ? object.how.trim() : 'fingerprint';
    return { selector, how };
}
function isSelectorSlotKey(slot) {
    return slot === 'input' || slot === 'response' || slot === 'newChat' || slot === 'stopButton';
}
/**
 * v2.5.73 (FIX 1-3): extrage `{ selector, how }` dintr-un răspuns de proxy, oricât
 * ar fi de împachetat (envelope OpenAI, string JSON dublu serializat, code
 * fences, proză). Întoarce `null` dacă răspunsul nu conține un obiect JSON cu
 * cheia `selector` (ex: forma multi-slot).
 */
function extractSelectorFromProxyResponse(reply) {
    const object = readAiJsonObject(reply);
    if (!object)
        return null;
    const single = selectorFromObject(object);
    if (!single) {
        log('parsed selector: null (răspuns fără cheia „selector")');
        return null;
    }
    log('parsed selector: ' + JSON.stringify(single));
    return { selector: single.selector, how: single.how, object };
}
/** Extrage primul obiect JSON echilibrat din text (ignoră string-urile). */
function extractJsonObject(text) {
    const t = String(text || '');
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [fence?.[1] ?? '', t];
    for (const c of candidates) {
        const start = c.indexOf('{');
        if (start < 0)
            continue;
        let depth = 0;
        let inStr = false;
        let esc = false;
        for (let i = start; i < c.length; i++) {
            const ch = c[i];
            if (inStr) {
                if (esc)
                    esc = false;
                else if (ch === '\\')
                    esc = true;
                else if (ch === '"')
                    inStr = false;
                continue;
            }
            if (ch === '"') {
                inStr = true;
                continue;
            }
            if (ch === '{')
                depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0)
                    return c.slice(start, i + 1);
            }
        }
    }
    return null;
}
/**
 * v2.5.73 (FIX 1-2): parser tolerant — acceptă atât forma multi-slot
 * (`{input,response,newChat,…}`) cât și forma „un singur selector" a
 * proxy-ului (`{selector, how}`), care e atribuită primului slot cerut
 * (`fallbackSlots` — healer-ul cere exact unul).
 */
function parseAIResponse(reply, fallbackSlots) {
    const parsed = readAiJsonObject(reply);
    if (!parsed)
        return null;
    const pick = (k) => {
        const v = parsed[k];
        if (typeof v !== 'string')
            return undefined;
        const s = v.trim();
        if (!s || s.length > 300)
            return undefined;
        const low = s.toLowerCase();
        if (low === 'null' || low === 'none' || low === 'n/a')
            return undefined;
        return s;
    };
    const conf = Number(parsed.confidence);
    const result = {
        input: pick('input'),
        response: pick('response'),
        newChat: pick('newChat'),
        stopButton: pick('stopButton'),
        confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 300) : ''
    };
    // v2.5.73 (FIX 1): răspunsul proxy-ului e `{selector, how}` (un singur
    // selector). Fără nicio cheie de slot, îl atribuim slotului cerut.
    const hasSlots = Boolean(result.input || result.response || result.newChat || result.stopButton);
    const target = fallbackSlots?.[0];
    if (!hasSlots && target && isSelectorSlotKey(target)) {
        const single = selectorFromObject(parsed);
        if (single && single.selector.length <= 300) {
            result[target] = single.selector;
            if (!result.reasoning)
                result.reasoning = single.how;
            log('parsed selector: ' + JSON.stringify(single));
        }
    }
    return result;
}
/** Un apel complet (open + send) cu timeout-ul din setări. */
async function askOllama(ollama, prompt, timeoutMs, parentSignal) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    if (parentSignal?.aborted)
        controller.abort();
    else
        parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    let timer;
    let timedOut = false;
    try {
        const work = (async () => {
            await ollama.open();
            if (controller.signal.aborted)
                throw new Error('AI finder aborted');
            return await ollama.send(undefined, prompt, controller.signal);
        })();
        // v2.5.17 (bug #44): la timeout promisiunea pierzătoare e abandonată —
        // fără handler, reject-ul ei ajunge „unhandled rejection" în extension host.
        work.catch(() => undefined);
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
                reject(new Error('timeout after ' + Math.round(timeoutMs / 1000) + 's'));
            }, timeoutMs);
        });
        try {
            return await Promise.race([work, timeout]);
        }
        catch (e) {
            if (timedOut) {
                throw new Error('timeout after ' + Math.round(timeoutMs / 1000) + 's');
            }
            throw e;
        }
    }
    finally {
        if (timer)
            clearTimeout(timer);
        parentSignal?.removeEventListener('abort', abortFromParent);
    }
}
/**
 * v2.5.41 (bug #95): verifică strict sloturile cerute. Doar căsuța de chat are
 * criterii proprii (vizibil, activ, acceptă text, în viewport, în jumătatea de
 * jos); restul sloturilor trec mai departe de regulile generale din
 * validateSelectors().
 *
 * v2.5.45 (bug #102): `required` = sloturile fără de care răspunsul e inutil
 * (pentru healer: slotul cerut; pentru descoperirea proactivă: doar `input`).
 * Un slot opțional rămas null NU mai respinge toată analiza — exact așa își
 * cere promptul „return null if you can't find a reliable selector".
 */
async function checkRequestedSlots(page, discovered, missingSlots, required, opts = {}) {
    for (const slot of selectors_1.SLOTS) {
        if (missingSlots.indexOf(slot) < 0)
            continue;
        const sel = discovered[slot];
        if (!sel) {
            if (slot === 'response') {
                // v2.5.47 (bug #106): AI-ul n-a propus nimic, dar fallback-ul generic
                // (data-message-author-role etc.) poate prinde totuși răspunsul.
                const check = await validateResponseSelector(page, '', opts);
                if (check.ok) {
                    discovered.response = check.selector;
                    continue;
                }
                // fără text de răspuns în DOM nu insistăm — descoperirea se amână
                return check.retryable ? { ok: false, reason: check.reason } : { ok: true };
            }
            if (required.indexOf(slot) < 0)
                continue;
            return { ok: false, reason: 'the AI answered null for "' + slot + '"' };
        }
        if (slot === 'input') {
            const check = await validateChatInputSelector(page, sel);
            if (!check.ok)
                return { ok: false, reason: String(check.reason), selector: sel };
            continue;
        }
        if (slot === 'response') {
            const check = await validateResponseSelector(page, sel, opts);
            if (check.ok) {
                // selectorul validat poate fi un părinte (Fix 3) sau fallback-ul (Fix 4)
                discovered.response = check.selector;
                continue;
            }
            if (check.retryable)
                return { ok: false, reason: check.reason, selector: sel };
            // fragment de răspuns, dar în pagină nu există text mai bun de măsurat:
            // slotul rămâne null (healer-ul va relua când chiar există un răspuns)
            delete discovered.response;
            continue;
        }
    }
    return { ok: true };
}
const activeFinders = new Map();
let cancelledFinderCount = 0;
function getAIFinderCancellationCount() {
    return cancelledFinderCount;
}
function cancelAIFinder(id) {
    const active = activeFinders.get(id);
    if (!active || active.controller.signal.aborted)
        return false;
    active.cancelled = true;
    cancelledFinderCount++;
    log('cancelled by user');
    (0, ai_finder_events_1.publishAIFinderStatus)({
        ...active.status,
        phase: 'cancelled',
        message: 'Repair cancelled. Bundled selectors remain active.'
    });
    active.controller.abort();
    return true;
}
async function isLoginOrCaptchaPage(page) {
    let url = '';
    try {
        url = page.url().toLowerCase();
    }
    catch {
        return false;
    }
    if (/\/(sign_in|login|signin|auth|register|signup|captcha)(?:[/?#]|$)/i.test(url)) {
        return true;
    }
    try {
        return await page.evaluate(() => {
            if (document.querySelector('input[type="password"]'))
                return true;
            const text = document.body?.innerText || '';
            return /\b(?:sign in|log in|verify you are human)\b/i.test(text);
        });
    }
    catch (e) {
        log('login/CAPTCHA probe failed: ' + (e?.message ?? String(e)));
        return false;
    }
}
async function findSelectorsWithAI(page, providerName, missingSlots, opts = {}) {
    if (await isLoginOrCaptchaPage(page)) {
        const providerId = opts.providerId || providerName;
        log('skip ' + providerId + ' — login/CAPTCHA page detected');
        if (opts.providerId)
            noteProviderNotReady(opts.providerId, 'login/CAPTCHA page');
        return null;
    }
    const id = opts.statusId || crypto.randomBytes(8).toString('hex');
    const statusBase = {
        id,
        providerId: opts.providerId || providerName,
        providerName
    };
    const active = {
        controller: new AbortController(),
        cancelled: false,
        status: statusBase
    };
    activeFinders.set(id, active);
    const silent = opts.silent === true;
    const mode = finderSettings().mode;
    const maxAttempts = mode === 'browser' || mode === 'api-proxy' ? 1 : exports.AI_FINDER_MAX_ATTEMPTS;
    const globalTimeoutMs = mode === 'browser'
        ? AI_FINDER_BROWSER_GLOBAL_TIMEOUT_MS
        : mode === 'api-proxy'
            ? AI_FINDER_PROXY_GLOBAL_TIMEOUT_MS
            : AI_FINDER_GLOBAL_TIMEOUT_MS;
    const globalTimeoutSeconds = Math.round(globalTimeoutMs / 1000);
    (0, ai_finder_events_1.publishAIFinderStatus)({
        ...statusBase,
        phase: 'running',
        attempt: 1,
        maxAttempts,
        message: 'Preparing the page for selector analysis…',
        silent
    });
    let timedOut = false;
    let timeout;
    let resolveAbort;
    const aborted = new Promise((resolve) => {
        resolveAbort = resolve;
    });
    const onAbort = () => resolveAbort(null);
    active.controller.signal.addEventListener('abort', onAbort, { once: true });
    const work = runFindSelectorsWithAI(page, providerName, missingSlots, {
        ...opts,
        signal: active.controller.signal,
        statusId: id
    });
    work.catch(() => undefined);
    const globalTimeout = new Promise((resolve) => {
        timeout = setTimeout(() => {
            timedOut = true;
            log('global timeout (' + globalTimeoutSeconds + 's, mode=' + mode + ') — aborting');
            (0, ai_finder_events_1.publishAIFinderStatus)({
                ...statusBase,
                phase: 'timeout',
                message: 'AI finder timed out after ' + globalTimeoutSeconds +
                    's. Bundled selectors are not working.',
                silent
            });
            active.controller.abort();
            resolve(null);
        }, globalTimeoutMs);
    });
    try {
        const result = await Promise.race([work, aborted, globalTimeout]);
        if (timedOut || active.cancelled)
            return null;
        if (result) {
            result.finderId = id;
            const accepted = [
                result.input && 'input=' + result.input,
                result.response && 'response=' + result.response,
                result.newChat && 'newChat=' + result.newChat,
                result.stopButton && 'stopButton=' + result.stopButton
            ].filter((value) => Boolean(value));
            (0, ai_finder_events_1.publishAIFinderStatus)({
                ...statusBase,
                phase: 'success',
                selectors: accepted,
                message: 'Selectors repaired: ' + (accepted.join(', ') || 'validated'),
                silent
            });
        }
        else {
            (0, ai_finder_events_1.publishAIFinderStatus)({
                ...statusBase,
                phase: 'failed',
                message: 'Repair failed. Manual intervention required.',
                silent
            });
        }
        return result;
    }
    catch (e) {
        if (!active.cancelled && !timedOut) {
            log('selector analysis failed: ' + (e?.message ?? String(e)));
            (0, ai_finder_events_1.publishAIFinderStatus)({
                ...statusBase,
                phase: 'failed',
                message: 'Repair failed. Manual intervention required.',
                silent
            });
        }
        return null;
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
        active.controller.signal.removeEventListener('abort', onAbort);
        activeFinders.delete(id);
    }
}
/**
 * Trimite snapshot-ul DOM la Ollama și întoarce selectorii propuși (sau null).
 *
 * v2.5.41 (bug #95): ce s-a propus e verificat în pagină înainte de a fi
 * întors; dacă pică, analiza se reia cu un prompt care spune ce a fost respins
 * (max AI_FINDER_MAX_ATTEMPTS). După ultima încercare nu se întoarce nimic.
 * Timeout-ul pe încercare se poate reîncerca o singură dată; timeout-ul global
 * și anularea utilizatorului opresc imediat fluxul.
 *
 * v2.5.45 (bug #102): `opts.required` (implicit = toate sloturile cerute) spune
 * care sloturi rămase null resping analiza, iar `opts.inputOnly` adaugă în
 * prompt blocul „căutăm doar căsuța de chat" (reparația de composer trunchiat).
 *
 * v2.5.47 (bug #106): `opts.providerId`/`opts.echoText` permit verificarea
 * „există răspuns în DOM?"; fără el, slotul `response` nu se cere deloc — vezi
 * deferral-ul de mai jos. `opts.replyPresent` sare peste verificare (apelantul
 * a dovedit-o deja).
 */
async function runFindSelectorsWithAI(page, providerName, missingSlots, opts = {}) {
    log('caut selectori cu AI pentru ' + providerName + ' (lipsesc: ' + missingSlots.join(',') + ')');
    // v2.5.45 (bug #102): fără `required` explicit, toate sloturile cerute sunt
    // obligatorii (comportamentul de dinainte, folosit de healer pe un singur slot).
    const required = opts.required ?? missingSlots;
    // v2.5.47 (bug #106): fără răspuns în DOM nu cerem (și nu acceptăm) un
    // selector de `response` — AI-ul ar ghici un container parțial, exact ca la
    // Qwen. Amânăm slotul pentru prima reparare reactivă, când există un răspuns
    // real de măsurat (validateResponseSelector are nevoie de conținut).
    let wanted = missingSlots;
    if (missingSlots.indexOf('response') >= 0) {
        const replyPresent = opts.replyPresent ??
            (opts.providerId !== undefined
                ? await hasResponseContentToFind(page, opts.providerId, opts.echoText)
                : false);
        if (!replyPresent) {
            wanted = missingSlots.filter((s) => s !== 'response');
            log('no reply in the DOM yet — deferring the response selector');
            if (!wanted.length)
                return null;
        }
    }
    const wantedRequired = required.filter((s) => wanted.indexOf(s) >= 0);
    // v2.5.63: modul decide dacă DOM-ul merge la proxy, la Ollama sau la browser.
    // `off` nu ajunge aici (apelanții verifică `enabled`).
    const mode = finderSettings().mode;
    if (mode === 'off') {
        log('AI finder disabled (freekit.aiSelectorFinder.mode=off)');
        return null;
    }
    let model = null;
    if (mode === 'ollama') {
        // v2.5.40 (bug #93): modelul se rezolvă ÎNAINTE de capturarea DOM-ului — cu
        // doar embeddings instalate nu mai plătim snapshot-ul degeaba.
        model = await resolveAiFinderModel();
        if (opts.signal?.aborted)
            return null;
        if (!model)
            return null;
    }
    else if (mode === 'browser' && !(0, browserAi_1.browserAiAvailable)()) {
        log('mode=browser needs a Chrome page factory — none registered, skipping');
        return null;
    }
    let url = '';
    try {
        url = page.url();
    }
    catch {
        /* pagină închisă — mergem mai departe cu URL gol */
    }
    let dom = '';
    try {
        // v2.5.41 (bug #96): textul conversației se păstrează doar când căutăm
        // containerul de răspuns — la input/butoane e exact zgomotul care strică.
        // v2.5.75 (FIX 3): pentru `newChat` adăugăm explicit sidebar-ul (linkul
        // „New chat" al Claude stă acolo, între linkurile de conversații).
        dom = await captureCleanDom(page, {
            includeText: wanted.indexOf('response') >= 0,
            sidebarHints: wanted.indexOf('newChat') >= 0
        });
    }
    catch (e) {
        log('captura DOM a eșuat: ' + (e?.message ?? String(e)));
        return null;
    }
    if (opts.signal?.aborted)
        return null;
    // v2.5.66 (FIX 1): în modul api-proxy DOM-ul se trunchiază ÎNAINTE de a intra
    // în prompt (altfel trunchierea din proxyAi.ts ar fi inutilă — promptul
    // conține deja snapshot-ul). Peste 12000 proxy-ul răspundea 400.
    if (mode === 'api-proxy' && dom.length > proxyAi_1.PROXY_MAX_DOM_CHARS) {
        log('DOM trunchiat pentru proxy: ' + dom.length + ' -> ' + proxyAi_1.PROXY_MAX_DOM_CHARS + ' caractere');
        dom = dom.slice(0, proxyAi_1.PROXY_MAX_DOM_CHARS - TRUNC_MARK.length) + TRUNC_MARK;
    }
    log('DOM capturat: ' + dom.length + ' caractere');
    const settings = finderSettings();
    const attemptTimeoutMs = Math.min(settings.timeoutMs, AI_FINDER_ATTEMPT_TIMEOUT_MS);
    // browser: o singură trecere (45s); ollama: până la două încercări de 30s
    const maxAttempts = mode === 'browser' || mode === 'api-proxy' ? 1 : exports.AI_FINDER_MAX_ATTEMPTS;
    const ollama = mode === 'ollama' ? new ollama_1.OllamaProvider({ model: model }) : null;
    if (mode === 'browser') {
        log('mode=browser, provider=' + browserAi_1.BROWSER_AI_PROVIDER + ', analyzing DOM (' +
            dom.length + ' chars)');
    }
    else if (mode === 'api-proxy') {
        log('mode=api-proxy, calling ' + (0, proxyAi_1.proxyAiHost)() + ' (DOM ' + dom.length + ' chars)');
    }
    else {
        log('mode=ollama, provider=' + model + ', analyzing DOM (' + dom.length + ' chars)');
    }
    let failureReason;
    let rejectedSelector;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (opts.signal?.aborted)
            return null;
        if (opts.statusId) {
            (0, ai_finder_events_1.publishAIFinderStatus)({
                id: opts.statusId,
                providerId: opts.providerId || providerName,
                providerName,
                phase: 'attempt',
                attempt,
                maxAttempts,
                message: mode === 'browser'
                    ? 'Analyzing the DOM in a new Chrome tab (up to 45s)…'
                    : mode === 'api-proxy'
                        ? 'Analyzing the DOM with the selector proxy (up to 30s)…'
                        : attempt === 1
                            ? 'Analyzing DOM (attempt 1/2) — up to 30s per attempt, 60s max.'
                            : 'Attempt 2/2 — retrying with a more specific prompt…',
                silent: opts.silent === true
            });
        }
        const prompt = buildPrompt({
            providerName,
            url,
            missingSlots: wanted,
            dom,
            attempt,
            failureReason,
            rejectedSelector,
            inputOnly: opts.inputOnly,
            onboarding: opts.onboarding
        });
        let reply = '';
        try {
            if (mode === 'browser') {
                const answer = await (0, browserAi_1.askBrowserAi)(prompt, {
                    timeoutMs: browserAi_1.BROWSER_AI_TIMEOUT_MS,
                    signal: opts.signal
                });
                if (!answer) {
                    log('mode=browser: nothing usable came back — no retry in browser mode');
                    return null;
                }
                reply = answer;
            }
            else if (mode === 'api-proxy') {
                const proxyStarted = Date.now();
                try {
                    reply = await (0, proxyAi_1.askProxyServer)(prompt, dom, opts.signal);
                    if (!reply.trim())
                        throw new Error('proxy returned an empty response');
                    // v2.5.69 (FIX 3): vizibil în Output → Freekit (dimensiune + durată reală)
                    log('proxy got reply (' +
                        reply.length +
                        ' chars, ' +
                        ((Date.now() - proxyStarted) / 1000).toFixed(1) +
                        's)');
                }
                catch (e) {
                    if (opts.signal?.aborted)
                        return null;
                    const reason = e?.message ?? String(e);
                    log('mode=api-proxy failed: ' + reason + ' — falling back to browser');
                    if (!(0, browserAi_1.browserAiAvailable)()) {
                        log('mode=api-proxy fallback unavailable — no browser page factory registered');
                        return null;
                    }
                    const answer = await (0, browserAi_1.askBrowserAi)(prompt, {
                        timeoutMs: browserAi_1.BROWSER_AI_TIMEOUT_MS,
                        signal: opts.signal
                    });
                    if (!answer) {
                        log('mode=browser fallback: nothing usable came back');
                        return null;
                    }
                    reply = answer;
                }
            }
            else {
                // fără istoric între încercări: promptul conține deja tot ce trebuie
                // (altfel cele 18k caractere de snapshot s-ar aduna peste num_ctx 8192)
                await ollama.newChat();
                if (opts.signal?.aborted)
                    return null;
                reply = await askOllama(ollama, prompt, attemptTimeoutMs, opts.signal);
            }
        }
        catch (e) {
            if (opts.signal?.aborted)
                return null;
            const reason = e?.message ?? String(e);
            if (/timeout after \d+s/i.test(reason)) {
                log(attempt < maxAttempts
                    ? 'attempt timeout (' + Math.ceil(attemptTimeoutMs / 1000) + 's) — retrying'
                    : 'attempt timeout (' + Math.ceil(attemptTimeoutMs / 1000) + 's) — maximum attempts reached');
                if (attempt >= maxAttempts)
                    return null;
                failureReason =
                    'the previous analysis timed out; keep the answer concise and return only the required JSON selectors';
                continue;
            }
            log('analiza AI a eșuat: ' + reason);
            return null;
        }
        log('răspuns AI: ' + reply.length + ' caractere');
        // v2.5.73 (FIX 1): `wanted` = sloturile cerute; dacă răspunsul e forma
        // „{selector}" a proxy-ului, selectorul e atribuit primului slot cerut.
        const parsed = parseAIResponse(reply, wanted);
        if (!parsed) {
            failureReason = 'your reply was not a valid JSON object';
            rejectedSelector = undefined;
            log('încercarea ' + attempt + '/' + maxAttempts + ' a eșuat: răspuns fără JSON');
            continue;
        }
        const verdict = await checkRequestedSlots(page, parsed, wanted, wantedRequired, {
            echoText: opts.echoText
        });
        if (verdict.ok)
            return parsed;
        failureReason = verdict.reason;
        rejectedSelector = verdict.selector;
        log('încercarea ' +
            attempt +
            '/' + maxAttempts +
            ' respinsă: ' +
            verdict.reason +
            (verdict.selector ? ' (' + verdict.selector + ')' : ''));
    }
    log('all proposed selectors failed validation — manual fix required');
    return null;
}
function normText(t) {
    return String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function containsThinkingMarkers(text) {
    return /thinking|reasoning|picturing|răspunzând/i.test(text);
}
/** Textul NU are voie să conțină mesajul tocmai trimis (containere de
 *  conversație, inclusiv cu istoric înainte) — ca garda din scan / isEchoOf.
 *  Doar mesaje lungi (≥40), ca cele scurte să nu respingă răspunsuri. */
function echoContains(text, message) {
    const m = normText(message);
    if (m.length < 40)
        return false;
    return normText(text).indexOf(m) >= 0;
}
function assignSlot(target, slot, selector) {
    if (slot === 'input')
        target.input = selector;
    else if (slot === 'response')
        target.response = selector;
    else if (slot === 'newChat')
        target.newChat = selector;
    else
        target.stopButton = selector;
}
/**
 * v2.5.41 (bug #95): validarea strictă a unui selector de căsuță de chat.
 * Testat în pagină cu `page.locator(selector)` (primul element e cel folosit și
 * la rulare, vezi resolveSlot) + criteriile din `checkInputCandidate`: vizibil
 * (nu display:none / width:0 / opacity:0), activ, acceptă text, în viewport și
 * în jumătatea de jos a paginii. Fără ele, AI-ul a salvat un input ascuns din
 * UI (`input[aria-label="Line wrap"]`) și a stricat ChatGPT până la fix manual.
 */
/**
 * v2.5.74 (FIX 2): `tag[attr="value"]` → părțile lui (null dacă selectorul e
 * altceva). Doar formei simple i se poate aplica potrivirea tolerantă de mai jos.
 */
function parseAttrSelector(selector) {
    const m = String(selector || '')
        .trim()
        .match(/^([a-zA-Z][\w-]*)\s*\[\s*([\w:-]+)\s*=\s*(['"])([\s\S]*?)\3\s*\]$/);
    if (!m)
        return null;
    return { tag: m[1], attr: m[2], value: m[4] };
}
/**
 * v2.5.74 (FIX 2): rescrie selectorul de atribut folosind VALOAREA REALĂ din
 * DOM (cu ghilimelele ei, tipografice sau nu). AI-ul propune
 * `textarea[placeholder="Ask Gemini"]`, dar pagina poate avea „Ask Gemini" cu
 * ghilimele tipografice — iar CSS acceptă doar `"`/`'` ca delimitatori, deci
 * varianta „înlocuim ghilimelele în selector" e invalidă. Potrivim valoarea
 * normalizat, în pagină, apoi construim un selector valid care conține textul
 * real. Întoarce `null` dacă nu găsește nimic.
 */
async function selectorWithNormalizedQuotes(page, selector) {
    const parsed = parseAttrSelector(selector);
    if (!parsed)
        return null;
    const actual = await page
        .evaluate((args) => {
        // scoatem TOATE ghilimelele (drepte sau tipografice) din comparație —
        // „Ask Gemini" (DOM) vs. "Ask Gemini" (propus de AI) trebuie să fie egal
        const norm = (s) => String(s ?? '')
            .replace(/["'\u2018\u2019\u201C\u201D\u00AB\u00BB\u2039\u203A]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        const want = norm(args.value);
        const nodes = Array.prototype.slice.call(document.querySelectorAll(args.tag));
        for (const el of nodes) {
            const v = el.getAttribute(args.attr);
            if (v !== null && norm(v) === want)
                return v;
        }
        return null;
    }, parsed)
        .catch(() => null);
    if (!actual)
        return null;
    const escaped = actual.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const rebuilt = parsed.tag + '[' + parsed.attr + '="' + escaped + '"]';
    return rebuilt === selector ? null : rebuilt;
}
async function validateChatInputSelector(page, selector) {
    const fail = (reason, count = 0) => ({
        count,
        selector,
        visible: false,
        enabled: false,
        acceptsText: false,
        inViewport: false,
        nearBottom: false,
        ok: false,
        reason
    });
    // v2.5.74 (FIX 2): dacă selectorul propus nu prinde nimic din cauza
    // ghilimelelor (drepte vs. tipografice), validăm varianta care chiar există
    // și o întoarcem ca `selector` — apelantul salvează ce a funcționat.
    let effective = selector;
    let count = 0;
    try {
        let loc = page.locator(effective);
        count = await loc.count();
        // v2.5.74 (FIX 2): „no element matches" poate fi doar o problemă de
        // ghilimele (drepte vs. tipografice) — căutăm valoarea reală în DOM și
        // reconstruim selectorul înainte de a respinge.
        if (count === 0) {
            const normalized = await selectorWithNormalizedQuotes(page, effective);
            if (normalized) {
                try {
                    const alt = page.locator(normalized);
                    const altCount = await alt.count();
                    if (altCount > 0) {
                        log('input selector matched with normalized quotes: ' + normalized);
                        effective = normalized;
                        loc = alt;
                        count = altCount;
                    }
                }
                catch {
                    /* selector reconstruit invalid — rămâne „no element matches" */
                }
            }
        }
        if (count === 0)
            return fail('no element matches', 0);
        if (count > 20)
            return fail('too generic (' + count + ' matches)', count);
        if (!(await loc.first().isVisible()))
            return fail('not visible', count);
        if (!(await loc.first().isEnabled()))
            return fail('disabled', count);
    }
    catch (e) {
        return fail('invalid selector (' + (e?.message ?? String(e)) + ')', count);
    }
    let probe;
    let viewport = { width: 0, height: 0 };
    try {
        const probed = await probeInputCandidates(page, effective, 1);
        probe = probed.probes[0];
        viewport = probed.viewport;
    }
    catch {
        /* mai jos raportăm „cannot be inspected" */
    }
    if (!probe)
        return fail('cannot be inspected', count);
    return { ...checkInputCandidate(probe, viewport), count, selector: effective };
}
/* -------------------------------------------------------------------------
 * v2.5.47 (bug #106) — SELECTORUL DE RĂSPUNS E VALIDAT PE CONȚINUT
 *
 * Test Qwen (7 Oct 2026, 17:20): AI finder-ul a propus `div.chat-response-message`
 * pentru `qwen.response`, iar validarea de dinainte (bug #95: există, vizibil,
 * jos) a trecut — dar citirea dădea doar 67 de caractere, în timp ce în browser
 * răspunsul era complet (ACTION: write_files + 5 fișiere) ⇒ tool call pierdut.
 * Cauza: se verifica EXISTENȚA elementului, nu CONȚINUTUL lui; un container
 * parțial (fragment de răspuns sau blocul de raționament) era acceptat.
 *
 * Reguli (toate măsurate cu reader-ul real — getLastResponseText, care scoate
 * și blocurile de thinking, vezi scanResponses):
 *  1. selectorul trebuie să dea ≥ RESPONSE_MIN_CHARS (200) caractere de text;
 *  2. dacă în pagină există un tool call (ACTION:/TOOL:/```/---FILE---) pe care
 *     selectorul nu-l citește, selectorul e respins (Fix 2);
 *  3. un selector prea specific urcă la părintele cu de 2x mai mult text (Fix 3);
 *  4. dacă tot nu iese nimic: fallback `[data-message-author-role="assistant"]`,
 *     apoi ultimul bloc mare de text din DOM (Fix 4);
 *  5. fără text de răspuns în DOM nu se acceptă NIMIC și nu se reîncearcă —
 *     descoperirea se amână pentru prima reparare reactivă, când există un
 *     răspuns real de măsurat (vezi și deferral-ul din findSelectorsWithAI).
 * ------------------------------------------------------------------------- */
/** Sub atâtea caractere de text real, „răspunsul" e doar un fragment. */
exports.RESPONSE_MIN_CHARS = 200;
/** Markerii unui tool call: dacă sunt în pagină, selectorul trebuie să-i prindă. */
exports.RESPONSE_TOOL_MARKERS = ['ACTION:', 'TOOL:', '```', '---FILE---'];
/** Părintele înlocuiește selectorul prea specific doar dacă are de atâtea ori text. */
exports.RESPONSE_PARENT_TEXT_RATIO = 2;
/** Peste atâtea caractere, un „bloc" nu mai poate fi răspunsul (e tot chatul). */
const RESPONSE_MAX_CHARS = 20000;
/** Câți strămoși inspectăm (containerul de răspuns e aproape de fragment). */
const RESPONSE_MAX_ANCESTORS = 3;
/**
 * Numărul maxim de potriviri acceptat pentru selectorul propus de AI.
 * v2.5.47 (bug #106): mare intenționat — un selector de răspuns CORECT prinde
 * sute de noduri într-o conversație lungă (`[data-message-author-role="assistant"]`
 * e chiar selectorul static de la ChatGPT, iar citirea ia oricum ULTIMUL nod).
 * Plasa de siguranță pentru `response` e CONȚINUTUL (≥ 200 caractere, tool call
 * prins, fără promo/ecou), nu numărul de potriviri.
 */
const RESPONSE_MAX_MATCHES = 500;
/** Fix 4: containerul standard de răspuns al asistentului (ca la ChatGPT). */
exports.RESPONSE_FALLBACK_SELECTORS = ['[data-message-author-role="assistant"]'];
/**
 * Citește din pagină tot ce trebuie pentru validarea de conținut: starea
 * ultimului nod potrivit, poziția tool call-ului, strămoșii folosibili ca
 * selector (Fix 3) și ultimul bloc mare de text (Fix 4). Rulează ÎN PAGINĂ
 * (page.evaluate) — toate utilitarele sunt definite local (funcția e
 * serializată), iar constantele vin prin `args`.
 */
async function probeResponseElement(page, selector, opts) {
    return page.evaluate((args) => {
        /**
         * textContent (nu innerText): scanul trece prin toate blocurile paginii,
         * iar innerText ar forța un reflow pentru fiecare. Măsurarea „reală" se
         * face oricum în Node, cu reader-ul paginii.
         */
        const textOf = (el) => String(el.textContent || '').trim();
        const isVisible = (el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 6 || r.height < 6)
                return false;
            const st = window.getComputedStyle(el);
            return st.visibility !== 'hidden' && st.display !== 'none';
        };
        // v2.5.13 (bug #37): sidebar-ul nu e răspuns — aceeași listă ca la citire.
        const inNav = (el) => {
            for (let i = 0; i < args.navSels.length; i++) {
                try {
                    if (el.closest(args.navSels[i]) !== null)
                        return true;
                }
                catch {
                    /* selector invalid — îl ignorăm */
                }
            }
            return false;
        };
        /** Composer-ul (sau un copil al lui) nu e niciodată „răspuns". */
        const inComposer = (el) => el.closest('textarea, input, [contenteditable="true"], [role="textbox"]') !== null;
        const hasMarker = (t) => {
            for (let i = 0; i < args.markers.length; i++) {
                if (t.indexOf(args.markers[i]) >= 0)
                    return true;
            }
            return false;
        };
        const escapeSel = (v) => v.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
        /**
         * Selector STABIL pentru un element (id > data-* > aria-label/role >
         * tag.clasă; tag-uri custom gen <chat-message>). Fără drumuri
         * poziționale — learn() le respinge oricum (isFragileSelector).
         */
        const simpleSelector = (el) => {
            const tag = el.tagName.toLowerCase();
            if (tag === 'html' || tag === 'body')
                return null;
            const matches = (sel) => {
                try {
                    const n = document.querySelectorAll(sel).length;
                    return n > 0 && n <= args.maxMatches;
                }
                catch {
                    return false;
                }
            };
            const id = el.getAttribute('id');
            if (id && /^[A-Za-z_][\w-]*$/.test(id) && matches('#' + escapeSel(id)))
                return '#' + id;
            const attrs = [
                'data-testid',
                'data-test-id',
                'data-message-author-role',
                'data-role',
                'aria-label',
                'role'
            ];
            for (let i = 0; i < attrs.length; i++) {
                const v = el.getAttribute(attrs[i]);
                if (!v || v.length > 60)
                    continue;
                const sel = tag + '[' + attrs[i] + '="' + v.replace(/"/g, '\\"') + '"]';
                if (matches(sel))
                    return sel;
            }
            const classes = String(el.className || '')
                .split(/\s+/)
                .filter((c) => c && c.length < 40 && !/[^a-zA-Z0-9_-]/.test(c));
            if (classes.length) {
                const sel = tag + '.' + escapeSel(classes[0]);
                if (matches(sel))
                    return sel;
            }
            return /-/.test(tag) ? tag : null;
        };
        const empty = {
            invalid: true,
            count: 0,
            visible: false,
            editable: false,
            role: null,
            userAncestor: false,
            markerBlock: 'none',
            parentCandidates: [],
            genericCandidates: []
        };
        let nodes = [];
        try {
            nodes = Array.prototype.slice.call(document.querySelectorAll(args.s));
        }
        catch {
            return empty;
        }
        const count = nodes.length;
        const node = count ? nodes[count - 1] : null;
        const rect = node ? node.getBoundingClientRect() : null;
        const style = node ? window.getComputedStyle(node) : null;
        const visible = !!(node &&
            rect &&
            style &&
            rect.width >= 6 &&
            rect.height >= 6 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none');
        const editable = !!(node &&
            (node.tagName === 'TEXTAREA' ||
                node.tagName === 'INPUT' ||
                node.isContentEditable === true ||
                node.getAttribute('contenteditable') === 'true'));
        let userAncestor = false;
        let up = node;
        let depth = 0;
        while (up && depth < 6) {
            const cls = typeof up.className === 'string' ? up.className : '';
            const ids = up.getAttribute('id') || '';
            if (/(^|[\s_-])user([\s_-]|$)/i.test(cls + ' ' + ids)) {
                userAncestor = true;
                break;
            }
            up = up.parentElement;
            depth++;
        }
        const pool = Array.prototype.slice.call(document.querySelectorAll('div, p, pre, code, li, article, section, blockquote, span'));
        /**
         * Fix 4b: „text NOU" = tot ce vine DUPĂ mesajul tocmai trimis. Fără
         * ancora lui, ultimul bloc mare din DOM poate fi un răspuns VECHI (dacă
         * răspunsul nou e scurt) sau un mesaj al userului.
         */
        let anchor = null;
        const echoFlat = String(args.echo || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        if (echoFlat.length >= 40) {
            const head = echoFlat.slice(0, 60);
            for (let i = pool.length - 1; i >= 0; i--) {
                const el = pool[i];
                if (inNav(el) || inComposer(el))
                    continue;
                const raw = el.textContent || '';
                if (raw.length > args.maxChars)
                    continue;
                const flat = raw.replace(/\s+/g, ' ').trim().toLowerCase();
                if (flat.indexOf(head) >= 0) {
                    anchor = el;
                    break;
                }
            }
        }
        const isNew = (el) => {
            if (!anchor)
                return true;
            if (anchor === el || anchor.contains(el))
                return true;
            // 4 = Node.DOCUMENT_POSITION_FOLLOWING
            return (anchor.compareDocumentPosition(el) & 4) !== 0;
        };
        // Fix 2: ultimul bloc care conține un marker de tool call. Copiii vin
        // DUPĂ părinți în ordinea documentului, deci primul găsit mergând invers
        // e cel mai interior; un marker dintr-un mesaj mai VECHI e înaintea
        // ancorei, deci nu poate produce un fals „after".
        let markerEl = null;
        for (let i = pool.length - 1; i >= 0; i--) {
            const el = pool[i];
            const t = textOf(el);
            if (!t || t.length > args.maxChars || !hasMarker(t))
                continue;
            if (!isVisible(el) || inNav(el) || inComposer(el) || !isNew(el))
                continue;
            markerEl = el;
            break;
        }
        let markerBlock = 'none';
        if (markerEl && node) {
            if (node === markerEl || node.contains(markerEl))
                markerBlock = 'inside';
            else {
                // 4 = Node.DOCUMENT_POSITION_FOLLOWING
                markerBlock = node.compareDocumentPosition(markerEl) & 4 ? 'after' : 'before';
            }
        }
        // Fix 3: strămoșii ultimului nod potrivit, inner → outer.
        const parentCandidates = [];
        let parent = node ? node.parentElement : null;
        let levels = 0;
        while (parent && levels < args.maxAncestors) {
            levels++;
            if (textOf(parent).length <= args.maxChars && isVisible(parent) && !inNav(parent) && !inComposer(parent)) {
                const sel = simpleSelector(parent);
                if (sel)
                    parentCandidates.push(sel);
            }
            parent = parent.parentElement;
        }
        // Fix 4b: ultimul bloc mare de text din DOM + urcarea „2x" până la
        // containerul de mesaj (peste el, textul crește prea puțin — e chatul).
        const genericCandidates = [];
        let seed = null;
        for (let i = pool.length - 1; i >= 0; i--) {
            const el = pool[i];
            const t = textOf(el);
            if (t.length < args.minChars || t.length > args.maxChars)
                continue;
            if (!isVisible(el) || inNav(el) || inComposer(el) || !isNew(el))
                continue;
            seed = el;
            break;
        }
        if (seed) {
            let cur = seed;
            let curLen = textOf(seed).length;
            for (let step = 0; step <= args.maxAncestors; step++) {
                const above = cur.parentElement;
                if (!above)
                    break;
                const aboveLen = textOf(above).length;
                if (aboveLen > args.maxChars || inNav(above) || inComposer(above))
                    break;
                if (aboveLen < curLen * 2)
                    break;
                cur = above;
                curLen = aboveLen;
            }
            const topSel = simpleSelector(cur);
            const seedSel = simpleSelector(seed);
            if (topSel)
                genericCandidates.push(topSel);
            if (seedSel && seedSel !== topSel)
                genericCandidates.push(seedSel);
        }
        return {
            invalid: false,
            count,
            visible,
            editable,
            role: node ? node.getAttribute('role') : null,
            userAncestor,
            markerBlock,
            parentCandidates,
            genericCandidates
        };
    }, {
        s: selector,
        navSels: selectors_1.NAV_SELECTORS,
        markers: exports.RESPONSE_TOOL_MARKERS,
        minChars: opts.minChars,
        maxChars: opts.maxChars,
        maxAncestors: opts.maxAncestors,
        maxMatches: opts.maxMatches,
        echo: String(opts.echo || '')
    });
}
function hasToolMarker(text) {
    for (const m of exports.RESPONSE_TOOL_MARKERS) {
        if (text.indexOf(m) >= 0)
            return true;
    }
    return false;
}
/** Textul pe care îl dă un selector azi, cu ACELAȘI reader ca la rulare. */
async function readResponseText(page, selector) {
    try {
        // v2.5.66 (FIX 4): citirea scoate paragrafele de „thinking" rămase în
        // elementul de răspuns — logăm câte, ca să se vadă filtrul în Output.
        const read = await (0, selectors_1.getLastResponseRead)(page, [selector]);
        if (read.filtered) {
            (0, log_1.logLine)('read', 'filtered ' + read.filtered + ' thinking paragraphs');
        }
        return read.text;
    }
    catch (e) {
        log('reading a candidate response failed (' + selector + '): ' + (e?.message ?? String(e)));
        return '';
    }
}
/**
 * v2.5.47 (bug #106): validează CONȚINUTUL unui selector de răspuns (vezi
 * blocul de mai sus). Întoarce `ok` + selectorul de folosit — care poate fi
 * propunerea AI, un părinte mai bogat (Fix 3) sau fallback-ul generic (Fix 4).
 */
async function validateResponseSelector(page, selector, opts = {}) {
    const want = String(selector || '').trim();
    let probe = null;
    if (want) {
        try {
            probe = await probeResponseElement(page, want, {
                minChars: exports.RESPONSE_MIN_CHARS,
                maxChars: RESPONSE_MAX_CHARS,
                maxAncestors: RESPONSE_MAX_ANCESTORS,
                maxMatches: RESPONSE_MAX_MATCHES,
                echo: opts.echoText
            });
        }
        catch (e) {
            log('probe of the proposed response failed (' + want + '): ' + (e?.message ?? String(e)));
            probe = null;
        }
    }
    let reason = 'the AI answered null for "response"';
    let chars = 0;
    let bestChars = 0;
    let needMarker = false;
    /** Propunerea AI a trecut de verificările structurale (nu e input/bulă/etc.). */
    let structurallyOk = false;
    /** Cel mai mult text dat de părinți/fallback-uri (baza excepției de mai jos). */
    let bestOther = 0;
    if (want && probe) {
        let structural = null;
        if (probe.invalid)
            structural = 'invalid selector';
        else if (probe.count === 0)
            structural = 'no element matches';
        else if (probe.count > RESPONSE_MAX_MATCHES)
            structural = 'too generic (' + probe.count + ' matches)';
        else if (!probe.visible)
            structural = 'not visible';
        else if (probe.editable || probe.role === 'textbox')
            structural = 'it matches the chat input';
        else if (probe.userAncestor)
            structural = 'it matches the user message bubble';
        // ce nu se poate stoca nu se acceptă nici aici (learn() îl refuză oricum):
        // altfel am raporta „validat" pentru un selector care moare la salvare
        else if (!(0, selectors_1.isUsableSelector)(want))
            structural = 'overly generic selector (' + want + ')';
        if (structural) {
            reason = structural;
            // măsurăm și propunerea respinsă structural: `chars` e baza regulii 2x
            // pentru părinți (altfel orice părinte ar trece drept „mai bogat")
            if (probe.count > 0) {
                const text = await readResponseText(page, want);
                chars = text.length;
                bestChars = chars;
                if (containsThinkingMarkers(text)) {
                    log('response rejected: contains thinking markers');
                    reason = 'contains thinking markers';
                }
            }
        }
        else {
            structurallyOk = true;
            const text = await readResponseText(page, want);
            chars = text.length;
            bestChars = chars;
            const hasThinkingMarkers = containsThinkingMarkers(text);
            if (hasThinkingMarkers) {
                log('response rejected: contains thinking markers');
                reason = 'contains thinking markers';
            }
            // Fix 2: un tool call din pagină care nu ajunge în textul citit = pierdut.
            const markerRequired = probe.markerBlock === 'after' || probe.markerBlock === 'inside';
            if (hasThinkingMarkers) {
                // Don't accept thinking/reasoning content as an assistant reply.
            }
            else if (!hasToolMarker(text) && markerRequired) {
                needMarker = true;
                log('response selector missed tool call markers');
                reason = 'response selector missed tool call markers';
            }
            else if (chars < exports.RESPONSE_MIN_CHARS) {
                // Fix 1: fragment de răspuns, nu răspunsul întreg.
                log('response selector rejected: only ' + chars + ' chars (need >' + exports.RESPONSE_MIN_CHARS + ')');
                reason = 'only ' + chars + ' chars (need >' + exports.RESPONSE_MIN_CHARS + ')';
            }
            else {
                const phrase = (0, selectors_1.promoPhraseHit)(text);
                if (phrase) {
                    log('response selector rejected (promo text „' + phrase + '"): ' + want);
                    reason = 'the text is a promo card ("' + phrase + '")';
                }
                else if (opts.echoText && echoContains(text, opts.echoText)) {
                    log('response selector rejected (it contains the message we just sent): ' + want);
                    reason = 'it contains the message we just sent';
                }
                else {
                    return {
                        ok: true,
                        reason: 'ok',
                        selector: want,
                        source: 'ai',
                        chars,
                        bestChars: chars,
                        retryable: false
                    };
                }
            }
        }
    }
    // Fix 3 + Fix 4: părintele cu de 2x mai mult text, apoi fallback-ul generic.
    const candidates = [];
    if (probe) {
        for (const p of probe.parentCandidates)
            candidates.push({ selector: p, source: 'parent' });
    }
    for (const f of exports.RESPONSE_FALLBACK_SELECTORS)
        candidates.push({ selector: f, source: 'fallback' });
    // Fix 4b doar când știm că tocmai s-a trimis un mesaj (ancora = mesajul
    // nostru, deci „text nou"): la descoperirea proactivă, de pe un ecran de
    // bun-venit, un bloc generic de 200+ caractere poate fi marketing sau
    // istoric, nu răspuns (Fix 5: mai bine amânăm decât să învățăm ceva greșit).
    if (probe && opts.echoText) {
        for (const g of probe.genericCandidates)
            candidates.push({ selector: g, source: 'fallback' });
    }
    const tried = new Set(want ? [want] : []);
    for (const c of candidates) {
        if (!c.selector || tried.has(c.selector) || !(0, selectors_1.isUsableSelector)(c.selector))
            continue;
        tried.add(c.selector);
        const text = await readResponseText(page, c.selector);
        const n = text.length;
        if (n > bestChars)
            bestChars = n;
        if (n > bestOther)
            bestOther = n;
        if (containsThinkingMarkers(text)) {
            log('response rejected: contains thinking markers');
            continue;
        }
        if (n < exports.RESPONSE_MIN_CHARS)
            continue;
        if (c.source === 'parent' && n <= Math.max(chars, 1) * exports.RESPONSE_PARENT_TEXT_RATIO)
            continue;
        if (needMarker && !hasToolMarker(text))
            continue;
        if ((0, selectors_1.promoPhraseHit)(text))
            continue;
        if (opts.echoText && echoContains(text, opts.echoText))
            continue;
        log((c.source === 'parent'
            ? 'response selector upgraded to parent: '
            : 'response selector fallback: ') + c.selector);
        return {
            ok: true,
            reason: 'ok',
            selector: c.selector,
            source: c.source,
            chars: n,
            bestChars,
            retryable: false
        };
    }
    // Fix 1 (excepție): un răspuns CHIAR scurt (sub 200 de caractere) nu e un
    // fragment. Dacă propunerea a trecut verificările structurale, nu pierde
    // niciun tool call și în pagină nu există text semnificativ mai mare, e cea
    // mai bună variantă — altfel am refuza orice răspuns scurt („Ok, gata.")
    // exact când selectorul static e rupt. Doar în reparația reactivă: `echoText`
    // e mesajul tocmai trimis, deci știm că un răspuns există.
    if (structurallyOk &&
        chars > 0 &&
        chars < exports.RESPONSE_MIN_CHARS &&
        !needMarker &&
        opts.echoText &&
        bestOther < Math.max(chars * exports.RESPONSE_PARENT_TEXT_RATIO, exports.RESPONSE_MIN_CHARS)) {
        log('response selector accepted as-is (short reply, ' + chars + ' chars)');
        return {
            ok: true,
            reason: 'ok',
            selector: want,
            source: 'ai',
            chars,
            bestChars,
            retryable: false
        };
    }
    // Fix 1.5/Fix 5: reîncercăm doar dacă ÎN PAGINĂ există text de răspuns de
    // măsurat — altfel AI-ul ar ghici iar un container parțial (bug #106).
    return {
        ok: false,
        reason,
        selector: '',
        source: 'none',
        chars,
        bestChars,
        retryable: bestChars >= exports.RESPONSE_MIN_CHARS
    };
}
/* -------------------------------------------------------------------------
 * v2.5.61 (FIX 1) — VALIDARE FUNCȚIONALĂ A CANDIDAȚILOR HEALER-ULUI
 *
 * Healer-ul de fingerprint alegea „cel mai bun" candidat doar după scor: pe
 * Claude alegea `button[user-message-retry]` pentru `newChat` — element care
 * există, e vizibil, dar NU e butonul de chat nou. Înainte de `learn()`, Freekit
 * TESTEAZĂ candidatul în pagină:
 *   - newChat : click → URL schimbat SAU conversația s-a golit; etichetele de
 *               acțiune (retry/regenerate/edit/delete) sunt respinse din start;
 *   - input   : type „x" → textul apare în căsuță → șterge; altfel respins;
 *   - response: citirea dă >RESPONSE_MIN_CHARS caractere; altfel respins.
 * Eșecul se loghează cu `[healer] candidate rejected: <selector> (functional
 * test failed)` și candidatul NU se salvează.
 * ------------------------------------------------------------------------- */
/**
 * Etichete care nu pot fi niciodată butonul de chat nou (FIX 1 + FIX 5).
 * v2.5.74 (FIX 1): + butoanele de banner/chrome — healer-ul alegea
 * `button[aria-label="Dismiss upgrade banner"]` pentru `claude.newChat` (există,
 * e vizibil, dar închide un banner de upsell).
 */
const NON_NEWCHAT_LABEL_RE = /retry|regenerate|edit|delete|remove|dismiss|upgrade|cancel|close/i;
/**
 * Click pe un candidat de newChat și măsurarea efectului.
 *
 * Testul se face DOAR pe un chat gol: click-ul e atunci ne-distructiv, iar
 * butonul corect lasă conversația goală (sau schimbă URL-ul). Pe o conversație
 * cu răspunsuri NU apăsăm nimic — un candidat greșit (ex. „retry") ar putea
 * distruge contextul utilizatorului, iar unul corect ar părea „fără efect";
 * acolo rămân verificările structurale (eticheta de acțiune + scorul din
 * scanCandidates, FIX 5).
 */
async function functionallyValidateNewChat(page, providerId, selector) {
    if (NON_NEWCHAT_LABEL_RE.test(selector)) {
        log('functional test failed for newChat ' + selector + ': action label (retry/regenerate/edit/delete)');
        return false;
    }
    const responseSelectors = selectors_1.selectors.candidates(providerId, 'response');
    let replies = 0;
    try {
        replies = await (0, selectors_1.countAssistantResponses)(page, responseSelectors);
    }
    catch {
        replies = 0;
    }
    if (replies > 0) {
        log('newChat ' + selector + ': the conversation has replies — the click test is skipped ' +
            '(non-destructive), structural checks only');
        return true;
    }
    const before = page.url();
    try {
        await page.locator(selector).first().click({ timeout: 5000 });
    }
    catch (e) {
        log('functional test failed for newChat ' + selector + ': click failed (' + (e?.message ?? String(e)) + ')');
        return false;
    }
    await sleep(1000);
    const changed = page.url() !== before;
    const stillEmpty = (await (0, selectors_1.countAssistantResponses)(page, responseSelectors).catch(() => 0)) === 0;
    if (!changed && !stillEmpty) {
        log('functional test failed for newChat ' + selector +
            ': the click did not start a new chat (the URL changed nowhere and a reply appeared)');
        return false;
    }
    return true;
}
/**
 * v2.5.61 (FIX 1): testul funcțional al unui candidat, în pagina reală.
 * Înregistrat în SelectorStore prin `setFunctionalValidator()`.
 */
async function functionallyValidateSlot(page, providerId, slot, selector) {
    const sel = String(selector || '').trim();
    if (!sel)
        return false;
    try {
        if (slot === 'response') {
            const check = await validateResponseSelector(page, sel);
            if (!check.ok) {
                log('functional test failed for response ' + sel + ': ' + check.reason);
                return false;
            }
            return true;
        }
        if (slot === 'input') {
            const check = await validateChatInputSelector(page, sel);
            if (!check.ok) {
                log('functional test failed for input ' + sel + ': ' + check.reason);
                return false;
            }
            const loc = page.locator(sel).first();
            await loc.click({ timeout: 5000 });
            await page.keyboard.insertText('x');
            await sleep(150);
            const typed = await loc.evaluate((el) => {
                const node = el;
                const value = node.value;
                return typeof value === 'string' ? value : node.innerText || node.textContent || '';
            });
            await page.keyboard.press('ControlOrMeta+A');
            await page.keyboard.press('Backspace');
            await sleep(80);
            if (String(typed || '').indexOf('x') < 0) {
                log('functional test failed for input ' + sel + ': the typed text did not appear');
                return false;
            }
            return true;
        }
        if (slot === 'newChat') {
            return await functionallyValidateNewChat(page, providerId, sel);
        }
        // stopButton e vizibil doar cât se generează — nu poate fi testat funcțional
        return true;
    }
    catch (e) {
        log('functional test failed for ' + slot + ' ' + sel + ': ' + (e?.message ?? String(e)));
        return false;
    }
}
/**
 * Validează selectorii propuși de AI în pagina reală (fără să învețe nimic).
 * Aplică aceleași reguli de siguranță ca scanul healer-ului: nu acceptăm
 * căsuța de input ca „response”, bula userului, texte promo sau ecouri.
 */
async function validateSelectors(page, discovered, opts = {}) {
    const valid = {
        confidence: discovered.confidence,
        reasoning: discovered.reasoning
    };
    for (const slot of selectors_1.SLOTS) {
        const sel = discovered[slot];
        if (!sel)
            continue;
        if (slot === 'input') {
            // v2.5.41 (bug #95): căsuța de chat are criterii proprii (vizibil, activ,
            // acceptă text, în viewport, în jumătatea de jos) — vezi
            // checkInputCandidate(). Regulile generale de mai jos nu se mai aplică.
            const check = await validateChatInputSelector(page, sel);
            if (!check.ok) {
                log('respins input (' + check.reason + '): ' + sel);
                continue;
            }
            // v2.5.74 (FIX 2): salvăm varianta care a potrivit (ghilimele normalizate)
            assignSlot(valid, slot, check.selector);
            log('validat ' + slot + ': ' + check.selector + ' (' + check.count + ' potriviri)');
            continue;
        }
        if (slot === 'response') {
            // v2.5.47 (bug #106): conținutul, nu doar existența — vezi
            // validateResponseSelector (≥200 caractere, tool call prins, părinte,
            // fallback generic).
            const check = await validateResponseSelector(page, sel, { echoText: opts.echoText });
            if (!check.ok) {
                log('respins response (' + check.reason + '): ' + sel);
                continue;
            }
            assignSlot(valid, slot, check.selector);
            log('validat ' + slot + ': ' + check.selector + ' (' + check.chars + ' caractere)');
            continue;
        }
        try {
            // v2.5.47 (bug #106): aici rămân doar `newChat`/`stopButton` — `response`
            // are propriul drum, cu validare de conținut (validateResponseSelector).
            const probe = await page.evaluate((args) => {
                let nodes;
                try {
                    nodes = document.querySelectorAll(args.s);
                }
                catch {
                    return { count: -1 };
                }
                const count = nodes.length;
                if (count === 0 || count > 20)
                    return { count };
                const el = nodes[0];
                const r = el.getBoundingClientRect();
                const st = window.getComputedStyle(el);
                const visible = r.width >= 6 && r.height >= 6 && st.visibility !== 'hidden' && st.display !== 'none';
                return { count, visible };
            }, { s: sel });
            if (!probe || probe.count === -1) {
                log('respins ' + slot + ' (selector invalid): ' + sel);
                continue;
            }
            if (probe.count === 0) {
                log('respins ' + slot + ' (0 potriviri): ' + sel);
                continue;
            }
            if (probe.count > 20) {
                log('respins ' + slot + ' (prea generic, ' + probe.count + ' potriviri): ' + sel);
                continue;
            }
            if (!probe.visible) {
                log('respins ' + slot + ' (invizibil): ' + sel);
                continue;
            }
            if ((slot === 'newChat' || slot === 'stopButton') && NON_ACTION_RE.test(sel)) {
                log('respins ' + slot + ' (buton non-acțiune): ' + sel);
                continue;
            }
            assignSlot(valid, slot, sel);
            log('validat ' + slot + ': ' + sel + ' (' + probe.count + ' potriviri)');
        }
        catch (e) {
            log('respins ' + slot + ' (' + (e?.message ?? String(e)) + '): ' + sel);
        }
    }
    return valid;
}
/* ---------------- 4) selectors-user.json (globalStorage) ---------------- */
const USER_FILE_NAME = 'selectors-user.json';
let storageDir = null;
/**
 * v2.5.44 (bug #101): fișierul are DOUĂ categorii, clar separate.
 *
 *   - „locked"  = selectori scriși/adăugați MANUAL de utilizator. Chei plate
 *                 `"<provider>.<slot>": "<selector>"` în rădăcină, dublate în
 *                 `_meta.locked`. Healer-ul (fingerprint), AI finder-ul și
 *                 override-urile de la server NU îi ating niciodată.
 *   - „providers" = selectori descoperiți automat (how='ai') — pot fi suprascriși.
 *
 * `_meta.writtenHash` = amprenta ultimului conținut scris DE NOI. Dacă fișierul
 * de pe disc nu corespunde, înseamnă că utilizatorul l-a editat manual: toate
 * intrările lui devin „locked" (regula de migrare pentru fișierele v1, care
 * fuseseră scrise manual de utilizator).
 *
 * `_meta` e ignorat la parsare ca „provider.slot" — nu e o intrare.
 *
 * v2.5.45 (bug #102), fișier v3: `_meta.auto` = copia plată a selectorilor
 * descoperiți automat („<provider>.<slot>": selector), iar
 * `_meta.discoveryDate.<provider>` = data ultimei descoperiri (cache 7 zile,
 * vezi DISCOVERY_CACHE_MS). Ambele sunt scrise de noi; la încărcare `_meta.auto`
 * e doar o a doua sursă pentru sloturile care lipsesc din `providers`.
 */
const USER_FILE_VERSION = 3;
/** Cheile rezervate din selectors-user.json (nu sunt „provider.slot"). */
const USER_FILE_RESERVED = new Set(['version', 'updated', 'providers', '_meta']);
/* -------------------------------------------------------------------------
 * v2.5.72 (FIX 1-6) — AUTO-UNLOCK PENTRU SELECTORI USER-LOCKED STRICAȚI
 *
 * Un selector scris manual („user-locked") pe care site-ul l-a stricat era
 * testat funcțional, eșua, dar NU putea fi reparat (healer-ul și AI Finder-ul
 * îl ocoleau). Acum se numără eșecurile consecutive per selector, iar la al
 * treilea selectorul iese din `_meta.locked`, AI Finder-ul e întrebat, iar la
 * succes noul selector e re-lockuit. Uniform pentru toți cei 6 provideri.
 * ------------------------------------------------------------------------- */
/** Providerii vizați de auto-unlock (toți cei cu automatizare în browser). */
exports.USER_LOCK_PROVIDERS = ['chatgpt', 'claude', 'deepseek', 'mistral', 'gemini', 'qwen'];
/** Sloturile numărate în `_meta.failures`. */
const USER_LOCK_KINDS = ['newChat', 'input', 'response'];
/** Câte backup-uri timestampate păstrăm (FIX 4). */
exports.BACKUP_KEEP = 5;
/** Numele de backup timestampat: `selectors-user.json.bak-YYYYMMDD-HHmmss`. */
const TIMESTAMPED_BACKUP_RE = /^selectors-user\.json\.bak-\d{8}-\d{6}$/;
/** Amprenta conținutului (fără `_meta`), ca să detectăm editarea manuală. */
function hashUserPayload(payload) {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}
/**
 * v2.5.44: fișierul e editat de mână, deci acceptăm (doar ca FALLBACK, după
 * JSON.parse) și comentarii (de linie sau de bloc) ori virgula finală.
 */
function parseUserJson(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        /* încercăm varianta tolerantă */
    }
    try {
        return JSON.parse(stripJsonComments(raw).replace(/,(\s*[}\]])/g, '$1'));
    }
    catch {
        return null;
    }
}
/** Scoate comentariile fără să atingă conținutul dintre ghilimele. */
function stripJsonComments(src) {
    let out = '';
    let inStr = false;
    let esc = false;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
            out += c;
            if (esc)
                esc = false;
            else if (c === '\\')
                esc = true;
            else if (c === '"')
                inStr = false;
            continue;
        }
        if (c === '"') {
            inStr = true;
            out += c;
            continue;
        }
        if (c === '/' && src[i + 1] === '/') {
            while (i < src.length && src[i] !== '\n')
                i++;
            out += '\n';
            continue;
        }
        if (c === '/' && src[i + 1] === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/'))
                i++;
            i++;
            continue;
        }
        out += c;
    }
    return out;
}
/** `"mistral.input"` → { provider: 'mistral', slot: 'input' } (sau null). */
function splitSlotKey(key) {
    const dot = key.lastIndexOf('.');
    if (dot <= 0)
        return null;
    const slot = key.slice(dot + 1);
    if (!selectors_1.SLOTS.includes(slot))
        return null;
    return { provider: key.slice(0, dot), slot: slot };
}
function userSelectorsFilePath() {
    return storageDir ? path.join(storageDir, USER_FILE_NAME) : null;
}
/* -------------------------------------------------------------------------
 * v2.5.61 (FIX 8) — BACKUP DE SELECTOARI BUNI
 *
 * Înainte de fiecare rescriere, conținutul de pe disc (adică ultima versiune
 * care a funcționat) e copiat în `selectors-user.json.backup`. Păstrăm ultimele
 * BACKUP_MAX_VERSIONS versiuni distincte (amprentă SHA-256, fără duplicate) și,
 * dacă toți selectorii se rup, tier-ul 5 al cascadei restaurează automat cea mai
 * nouă versiune de acolo.
 * ------------------------------------------------------------------------- */
const BACKUP_FILE_NAME = USER_FILE_NAME + '.backup';
/** Câte versiuni bune păstrăm (FIX 8). */
exports.BACKUP_MAX_VERSIONS = 3;
function userBackupFilePath() {
    return storageDir ? path.join(storageDir, BACKUP_FILE_NAME) : null;
}
/** true cât timp scriem fișierul restaurat — nu vrem să „îngropăm" versiunile bune. */
let backupSuppressed = false;
function readBackupStore(file) {
    const empty = { version: 1, updated: '', versions: [] };
    try {
        if (!fs.existsSync(file))
            return empty;
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.versions))
            return empty;
        const versions = parsed.versions
            .filter((v) => v && typeof v.hash === 'string' && v.payload && typeof v.payload === 'object')
            .slice(0, exports.BACKUP_MAX_VERSIONS);
        return { version: 1, updated: String(parsed.updated || ''), versions };
    }
    catch (e) {
        log('backup: fișierul de backup e invalid — ignorat: ' + (e?.message ?? String(e)));
        return empty;
    }
}
/** Copiază versiunea curentă a fișierului în backup (înainte de rescriere). */
function backupCurrentUserSelectors() {
    if (backupSuppressed)
        return;
    const file = userSelectorsFilePath();
    const backup = userBackupFilePath();
    if (!file || !backup || !fs.existsSync(file))
        return;
    try {
        const raw = fs.readFileSync(file, 'utf8');
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        const store = readBackupStore(backup);
        if (store.versions.length && store.versions[0].hash === hash)
            return; // neschimbat
        const payload = JSON.parse(raw);
        store.versions.unshift({ at: new Date().toISOString(), hash, payload });
        store.versions = store.versions.slice(0, exports.BACKUP_MAX_VERSIONS);
        store.updated = new Date().toISOString();
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.writeFileSync(backup, JSON.stringify(store, null, 2) + '\n', 'utf8');
        log('backup: ' + store.versions.length + ' good version(s) kept');
    }
    catch (e) {
        log('backup failed: ' + (e?.message ?? String(e)));
    }
}
/**
 * v2.5.72 (FIX 4): backup timestampat al fișierului, luat ÎNAINTE de a scoate
 * vreun selector din `_meta.locked`. Numele e `selectors-user.json.bak-
 * YYYYMMDD-HHmmss`; păstrăm ultimele BACKUP_KEEP (cele mai vechi se șterg).
 * Backup-ul e SINGUR pentru tot fișierul (toți cei 6 provideri deodată).
 */
function timestampSuffix(d = new Date()) {
    // v2.5.73 (FIX 5): timp LOCAL (getFullYear/getHours…), nu UTC — numele
    // `bak-YYYYMMDD-HHmmss` trebuie să corespundă ceasului utilizatorului.
    const p = (n) => String(n).padStart(2, '0');
    return (d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
        p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()));
}
/** Șterge backup-urile timestampate peste limita BACKUP_KEEP (cele mai vechi). */
function pruneTimestampedBackups(dir) {
    try {
        const entries = fs
            .readdirSync(dir)
            .filter((name) => TIMESTAMPED_BACKUP_RE.test(name))
            // formatul e cronologic la sortarea lexicografică (YYYYMMDD-HHmmss)
            .sort();
        const excess = entries.length - exports.BACKUP_KEEP;
        for (let i = 0; i < excess; i++) {
            fs.rmSync(path.join(dir, entries[i]), { force: true });
            tierLog('backup pruned: ' + entries[i]);
        }
    }
    catch (e) {
        log('backup prune failed: ' + (e?.message ?? String(e)));
    }
}
/** v2.5.72 (FIX 4): salvează `selectors-user.json.bak-<timestamp>` înainte de unlock. */
function backupTimestampedUserSelectors() {
    const file = userSelectorsFilePath();
    if (!file || !fs.existsSync(file))
        return null;
    try {
        const name = USER_FILE_NAME + '.bak-' + timestampSuffix();
        const dir = path.dirname(file);
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(file, path.join(dir, name));
        tierLog('backup saved: ' + name);
        pruneTimestampedBackups(dir);
        return name;
    }
    catch (e) {
        log('timestamped backup failed: ' + (e?.message ?? String(e)));
        return null;
    }
}
/**
 * v2.5.66 (FIX 1): migrația șterge selectorii auto invalizi din fișier, dar
 * versiunea de dinainte (cu ei cu tot) intră în backup la `saveUserSelectors`.
 * Îi scoatem din TOATE versiunile de backup, ca tier 5 să nu-i aducă înapoi.
 * Log explicit: `[migration] purged <key> from backup too`.
 */
function purgeFromBackup(keys) {
    const backup = userBackupFilePath();
    if (!backup || !keys.length || !fs.existsSync(backup))
        return;
    try {
        const store = readBackupStore(backup);
        const purged = [];
        let changed = false;
        for (const version of store.versions) {
            const payload = version.payload;
            if (!payload || typeof payload !== 'object')
                continue;
            for (const key of keys) {
                const parsed = splitSlotKey(key);
                if (!parsed)
                    continue;
                let hit = false;
                if (Object.prototype.hasOwnProperty.call(payload, key)) {
                    delete payload[key];
                    hit = true;
                }
                const providers = payload.providers;
                if (providers &&
                    typeof providers === 'object' &&
                    providers[parsed.provider] &&
                    providers[parsed.provider][parsed.slot] !== undefined) {
                    delete providers[parsed.provider][parsed.slot];
                    hit = true;
                }
                if (hit) {
                    changed = true;
                    if (purged.indexOf(key) < 0)
                        purged.push(key);
                }
            }
        }
        if (!changed)
            return;
        store.updated = new Date().toISOString();
        fs.writeFileSync(backup, JSON.stringify(store, null, 2) + '\n', 'utf8');
        for (const key of purged)
            (0, log_1.logLine)('migration', 'purged ' + key + ' from backup too');
    }
    catch (e) {
        log('backup purge failed: ' + (e?.message ?? String(e)));
    }
}
/**
 * v2.5.61 (FIX 8) / tier 5 (FIX 7): restaurează selecțiile din backupul cu
 * versiuni bune. Întoarce selectorul pentru `slot`, dacă a fost restaurat.
 */
function restoreFromBackup(providerId, slot) {
    const backup = userBackupFilePath();
    if (!backup)
        return null;
    const store = readBackupStore(backup);
    if (!store.versions.length)
        return null;
    // v2.5.66 (FIX 1/3): selectorii șterși de migrație nu se restaurează NICIODATĂ
    const purged = migrationPurgedKeys();
    const skipped = new Set();
    tierLog('backup restore attempt for ' + providerId + '.' + slot + ' (' +
        store.versions.length + ' version(s) available)');
    for (const version of store.versions) {
        const payload = version.payload;
        if (!payload || typeof payload !== 'object')
            continue;
        let restored = 0;
        // cheile plate „provider.slot" (selecții manuale) + `providers` (auto)
        for (const [key, value] of Object.entries(payload)) {
            if (USER_FILE_RESERVED.has(key))
                continue;
            const parsed = splitSlotKey(key);
            if (!parsed)
                continue;
            const slotKey = parsed.provider + '.' + parsed.slot;
            if (purged.has(slotKey)) {
                if (!skipped.has(slotKey)) {
                    skipped.add(slotKey);
                    tierLog('backup restore skipped ' + slotKey + ' (purged by migration)');
                }
                continue;
            }
            const sel = typeof value === 'string' ? value : value?.selector;
            if (typeof sel === 'string' && selectors_1.selectors.learnLocked(parsed.provider, parsed.slot, sel)) {
                restored++;
            }
        }
        const providers = payload.providers;
        if (providers && typeof providers === 'object') {
            for (const [pid, slots] of Object.entries(providers)) {
                if (!slots || typeof slots !== 'object')
                    continue;
                for (const s of selectors_1.SLOTS) {
                    const entry = slots[s];
                    const sel = typeof entry === 'string' ? entry : entry?.selector;
                    if (typeof sel !== 'string' || !sel.trim())
                        continue;
                    if (purged.has(pid + '.' + s)) {
                        if (!skipped.has(pid + '.' + s)) {
                            skipped.add(pid + '.' + s);
                            tierLog('backup restore skipped ' + pid + '.' + s + ' (purged by migration)');
                        }
                        continue;
                    }
                    if (selectors_1.selectors.learn(pid, s, sel.trim(), 'ai'))
                        restored++;
                }
            }
        }
        if (!restored)
            continue;
        backupSuppressed = true;
        try {
            saveUserSelectors();
        }
        finally {
            backupSuppressed = false;
        }
        tierLog('restored from backup (' + store.versions.length + ' versions)');
        return selectors_1.selectors.learned(providerId, slot)?.selector ?? null;
    }
    return null;
}
/**
 * Rescrie fișierul: selecțiile „locked" (scrise manual) ca chei plate, cele
 * descoperite de AI (how='ai') sub `providers`.
 */
function saveUserSelectors() {
    const file = userSelectorsFilePath();
    if (!file)
        return;
    // v2.5.61 (FIX 8): versiunea de dinaintea rescrierii intră în backup
    backupCurrentUserSelectors();
    const locked = {};
    const providers = {};
    let lockedCount = 0;
    let count = 0;
    for (const item of selectors_1.selectors.listLearned()) {
        if (item.locked) {
            locked[item.provider + '.' + item.slot] = item.selector;
            lockedCount++;
            continue;
        }
        // v2.5.65 (FIX 4): și reparațiile prin fingerprint ajung în fișier — altfel
        // un selector găsit de „deferred repair" trăia doar în memorie/globalState
        // și dispărea din `selectors-user.json` (deși funcționa).
        // v2.5.75 (FIX 2): fallback-urile fragile (poziționale) se persistă separat
        // (`fragile: true`), ca să nu fie confundate cu o reparație stabilă și să
        // rămână la coada candidaților la reîncărcare.
        if (item.how !== 'ai' && item.how !== 'fingerprint' && item.how !== 'fragile')
            continue;
        if (!providers[item.provider])
            providers[item.provider] = {};
        providers[item.provider][item.slot] = {
            selector: item.selector,
            how: item.how,
            at: item.at,
            confidence: item.confidence,
            reasoning: item.reasoning,
            ...(item.how === 'fragile' ? { fragile: true } : {})
        };
        count++;
    }
    const payload = {
        version: USER_FILE_VERSION,
        updated: new Date().toISOString(),
        ...locked
    };
    if (count)
        payload.providers = providers;
    // v2.5.45 (bug #102): `_meta.auto` = aceiași selectori descoperiți automat,
    // dar într-o listă plată „<provider>.<slot>": ușor de citit/șters de mână și
    // explicit „auto" (nu „locked", ca cheile plate din rădăcină).
    const auto = {};
    for (const [pid, slots] of Object.entries(providers)) {
        for (const [slot, entry] of Object.entries(slots)) {
            const sel = entry?.selector;
            if (typeof sel === 'string' && sel)
                auto[pid + '.' + slot] = sel;
        }
    }
    // v2.5.72 (FIX 1): `_meta.failures` = eșecuri consecutive per selector
    // user-locked (toți cei 6 provideri × newChat/input/response). Valorile
    // implicite sunt 0, ca fișierul să aibă mereu toate cheile (ușor de editat).
    const failures = {};
    for (const pid of exports.USER_LOCK_PROVIDERS) {
        for (const kind of USER_LOCK_KINDS) {
            failures[pid + '.' + kind] = selectors_1.selectors.lockFailureCount(pid, kind);
        }
    }
    for (const [key, value] of selectors_1.selectors.lockFailuresSnapshot()) {
        if (!(key in failures))
            failures[key] = value;
    }
    const meta = { locked: Object.keys(locked), failures };
    if (count)
        meta.auto = auto;
    if (discoveryDates.size) {
        const dates = {};
        for (const [pid, at] of discoveryDates)
            dates[pid] = new Date(at).toISOString();
        meta.discoveryDate = dates;
    }
    // amprenta se calculează ÎNAINTE de a adăuga `_meta` (altfel s-ar auto-include)
    payload._meta = { ...meta, writtenHash: hashUserPayload(payload) };
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
        log('selectors-user.json salvat (' +
            count +
            ' selectori AI' +
            (lockedCount ? ', ' + lockedCount + ' user-locked' : '') +
            ')');
    }
    catch (e) {
        log('scrierea selectors-user.json a eșuat: ' + (e?.message ?? String(e)));
    }
}
/**
 * Încarcă selectors-user.json la pornire.
 *
 * v2.5.44 (bug #101): fișierul e tratat ca sursă de adevăr pentru selecțiile
 * MANUALE. Dacă a fost editat de utilizator (sau e un fișier v1, scris de
 * mână), tot ce conține e marcat „locked" și healer-ul nu se mai atinge de
 * acele sloturi. Intrările automate respinse de validare se șterg doar dacă
 * fișierul e al nostru (nu-l rescriem niciodată peste o editare manuală).
 */
function loadUserSelectorsFromDisk() {
    const file = userSelectorsFilePath();
    if (!file || !fs.existsSync(file))
        return;
    let data;
    try {
        data = parseUserJson(fs.readFileSync(file, 'utf8'));
    }
    catch (e) {
        log('selectors-user.json invalid — ignorat: ' + (e?.message ?? String(e)));
        return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        log('selectors-user.json invalid — ignorat (nu e un obiect JSON)');
        return;
    }
    const meta = data._meta && typeof data._meta === 'object' ? data._meta : {};
    const baseline = { ...data };
    delete baseline._meta;
    const storedHash = typeof meta.writtenHash === 'string' ? meta.writtenHash : '';
    // fără amprenta noastră (fișier v1) sau cu altă amprentă => scris de mână
    const userEdited = !storedHash || storedHash !== hashUserPayload(baseline);
    const declaredLocked = new Set(Array.isArray(meta.locked) ? meta.locked.map((k) => String(k)) : []);
    // v2.5.72 (FIX 1): contoarele de eșec persistate per selector user-locked.
    if (meta.failures && typeof meta.failures === 'object') {
        const record = {};
        for (const [key, value] of Object.entries(meta.failures)) {
            const n = Number(value);
            if (Number.isFinite(n) && n > 0)
                record[key] = Math.floor(n);
        }
        selectors_1.selectors.hydrateLockFailures(record);
        if (Object.keys(record).length) {
            log('selectors-user.json: contoare de eșec încărcate (' +
                Object.keys(record).length + ')');
        }
    }
    // v2.5.45 (bug #102): data ultimei descoperiri (cache-ul de 7 zile).
    if (meta.discoveryDate && typeof meta.discoveryDate === 'object') {
        for (const [pid, when] of Object.entries(meta.discoveryDate)) {
            const t = Date.parse(String(when));
            if (Number.isFinite(t))
                discoveryDates.set(pid, t);
        }
    }
    let loaded = 0;
    let auto = 0;
    let pruned = 0;
    const handled = new Set();
    // (a) chei plate „provider.slot" = selecții scrise manual → locked implicit
    for (const [key, value] of Object.entries(data)) {
        if (USER_FILE_RESERVED.has(key))
            continue;
        const parsed = splitSlotKey(key);
        if (!parsed)
            continue;
        const sel = typeof value === 'string' ? value : value?.selector;
        if (typeof sel !== 'string' || !sel.trim())
            continue;
        if (selectors_1.selectors.learnLocked(parsed.provider, parsed.slot, sel)) {
            loaded++;
            handled.add(parsed.provider + '.' + parsed.slot);
        }
    }
    // (b) `providers` = descoperite automat; la o editare manuală devin și ele
    // locked (migrarea v1: tot ce exista în fișier fusese scris de utilizator)
    const providers = data.providers;
    if (providers && typeof providers === 'object') {
        for (const [pid, slots] of Object.entries(providers)) {
            if (!slots || typeof slots !== 'object')
                continue;
            for (const slot of selectors_1.SLOTS) {
                const entry = slots[slot];
                const sel = typeof entry === 'string' ? entry : entry?.selector;
                if (typeof sel !== 'string' || !sel.trim())
                    continue;
                handled.add(pid + '.' + slot);
                if (userEdited || entry?.locked === true || declaredLocked.has(pid + '.' + slot)) {
                    if (selectors_1.selectors.learnLocked(pid, slot, sel))
                        loaded++;
                    continue;
                }
                // v2.5.75 (FIX 2): fallback-urile fragile se reîncarcă prin learnFallback()
                // (nu prin `learn()`, care respinge intenționat selectorii poziționali)
                if (entry && typeof entry === 'object' && entry.fragile === true) {
                    if (selectors_1.selectors.learnFallback(pid, slot, sel.trim())) {
                        loaded++;
                        auto++; // e o intrare automată (nu o selecție manuală) — vezi logul de mai jos
                    }
                    continue;
                }
                const meta2 = entry && typeof entry === 'object'
                    ? { confidence: Number(entry.confidence), reasoning: String(entry.reasoning || '') }
                    : undefined;
                if (selectors_1.selectors.learn(pid, slot, sel.trim(), 'ai', meta2)) {
                    loaded++;
                    auto++;
                }
                else {
                    pruned++;
                    log('selectors-user.json: „' + pid + '.' + slot + '” respins la încărcare — ' + sel);
                }
            }
        }
    }
    // (c) v2.5.45 (bug #102): `_meta.auto` — lista plată a descoperirilor
    // automate, pentru sloturile care lipsesc din `providers`. Un fișier editat
    // manual nu resuscitează nimic prin ea.
    if (!userEdited && meta.auto && typeof meta.auto === 'object') {
        for (const [key, value] of Object.entries(meta.auto)) {
            const parsed = splitSlotKey(key);
            if (!parsed || handled.has(key))
                continue;
            const sel = typeof value === 'string' ? value.trim() : '';
            if (!sel)
                continue;
            if (selectors_1.selectors.learn(parsed.provider, parsed.slot, sel, 'ai')) {
                loaded++;
                auto++;
            }
        }
    }
    if (loaded) {
        log('selectors-user.json: ' + loaded + ' selectori încărcați (' +
            (loaded - auto) + ' user-locked' + (auto ? ', ' + auto + ' auto' : '') + ')');
    }
    if (userEdited) {
        log('selectors-user.json editat manual — toate intrările lui sunt user-locked ' +
            '(healer-ul nu le mai atinge; șterge o intrare ca să reactivezi auto-repararea)');
        saveUserSelectors(); // adaugă marcajul „locked" + amprenta
    }
    else if (pruned) {
        saveUserSelectors(); // rescrie fără intrările respinse
    }
}
/* -------------------------------------------------------------------------
 * v2.5.65 (FIX 5) — MIGRAȚIE LA UPDATE DE VERSIUNE
 *
 * Un selector auto salvat greșit (ex: `claude.response` învățat ca
 * `div[role="feed"] > div[data-testid="transcript-sizer"] > …`) rămâne „lipit"
 * peste slot și umbrește selectorul bundled, corect. La fiecare versiune nouă
 * a extensiei ștergem din `selectors-user.json` selectori invalizi — obligatoriu
 * pentru `claude`, plus orice alt provider cu selectori structural invalizi —
 * apoi rescriem fișierul. Rulează o singură dată per versiune (marker pe disc).
 * ------------------------------------------------------------------------- */
const MIGRATION_FILE_NAME = 'selectors-migration.json';
/** Providerii ale căror selecții auto se resetează la fiecare update de versiune. */
const MIGRATION_RESET_PROVIDERS = new Set(['claude']);
function migrationFilePath() {
    return storageDir ? path.join(storageDir, MIGRATION_FILE_NAME) : null;
}
/**
 * v2.5.66 (FIX 1): cheile șterse de migrație („provider.slot"), persistate în
 * marker. Tier 5 (backup) NU are voie să le restaureze — altfel migrația le șterge
 * și backupul le aduce imediat înapoi.
 */
function migrationPurgedKeys() {
    const file = migrationFilePath();
    if (!file)
        return new Set();
    try {
        if (!fs.existsSync(file))
            return new Set();
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        const list = Array.isArray(parsed?.purged) ? parsed.purged : [];
        return new Set(list.filter((k) => typeof k === 'string'));
    }
    catch {
        return new Set();
    }
}
/**
 * v2.5.65 (FIX 5): un selector auto e „invalid" dacă e evident rupt — lanțuri
 * kilometrici de DOM, structuri interne de tranzcript (Claude) sau, la
 * `response`, ceva ce trimite la caseta de input.
 */
function looksLikeInvalidAutoSelector(slot, selector) {
    const s = String(selector || '').toLowerCase();
    if (!s)
        return true;
    if (s.length > 200)
        return true;
    if (s.indexOf('transcript-sizer') >= 0 || s.indexOf('transcript-row') >= 0)
        return true;
    if (slot === 'response' && /textbox|contenteditable|composer/.test(s))
        return true;
    return false;
}
/**
 * v2.5.65 (FIX 5): curăță selectorii auto invalizi la schimbarea versiunii.
 * Log explicit (`[migration] removed invalid claude.* selectors`) ca să se vadă
 * în Output → Freekit.
 */
function runSelectorMigration(version) {
    const file = migrationFilePath();
    if (!file || !version)
        return;
    let last = '';
    try {
        if (fs.existsSync(file)) {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            last = String(parsed?.version || '');
        }
    }
    catch (e) {
        log('migration: marker read failed: ' + (e?.message ?? String(e)));
    }
    if (last === version)
        return;
    const removed = {};
    const purgedKeys = [];
    let count = 0;
    for (const pid of selectors_1.selectors.providerIds()) {
        const force = MIGRATION_RESET_PROVIDERS.has(pid);
        for (const slot of selectors_1.SLOTS) {
            const learned = selectors_1.selectors.learned(pid, slot);
            if (!learned || learned.locked)
                continue;
            // v2.5.75 (FIX 2): un fallback FRAGIL e ultima plasă de siguranță a
            // slotului (ex: butonul „New chat" al Claude fără href/aria-label) —
            // „resetarea forțată" la update de versiune l-ar lăsa iar fără selector.
            // Rămâne totuși la coada candidaților, iar dacă e structural invalid cade.
            if (learned.how === 'fragile') {
                if (!looksLikeInvalidAutoSelector(slot, learned.selector))
                    continue;
            }
            else if (!force && !looksLikeInvalidAutoSelector(slot, learned.selector)) {
                continue;
            }
            if (selectors_1.selectors.forget(pid, slot)) {
                count++;
                (removed[pid] = removed[pid] || []).push(slot);
                purgedKeys.push(pid + '.' + slot);
            }
        }
    }
    if (count) {
        // v2.5.66 (FIX 1): versiunea de dinainte (cu selectorii invalizi) intră în
        // backup la saveUserSelectors(), deci purgăm backupul DUPĂ salvare — altfel
        // tier 5 îi restaurează imediat (exact bug-ul „backup restore anulează
        // migration").
        saveUserSelectors();
        purgeFromBackup(purgedKeys);
        for (const [pid, slots] of Object.entries(removed)) {
            (0, log_1.logLine)('migration', 'removed invalid ' + pid + '.* selectors (' + slots.join(', ') + ')');
        }
    }
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ version, at: new Date().toISOString(), purged: purgedKeys }, null, 2) + '\n', 'utf8');
    }
    catch (e) {
        log('migration: marker write failed: ' + (e?.message ?? String(e)));
    }
}
/* ---------------- 5) adaptorul pentru healSlot ---------------- */
const recentAttempts = new Map();
const inFlight = new Set();
/**
 * v2.5.61 (FIX 8): sloturile deja restaurate din backup în sesiunea curentă —
 * un restore nu se repetă (altfel un selector restaurat care pică iar ar fi
 * restaurat la nesfârșit, în buclă cu FIX 4).
 */
const backupRestored = new Set();
/** Doar pentru teste: resetează rate limiting-ul. */
function resetAIFinderCache() {
    recentAttempts.clear();
    inFlight.clear();
}
/**
 * v2.5.73 (FIX 4): când AI Finder-ul nu produce un selector NOU valid (timeout,
 * răspuns neparsabil, selector respins la validare) NU mai ștergem override-ul
 * existent. Vechiul `dropStaleOverride` (v2.5.17) ștergea override-ul bun, iar
 * tier 5 (backup) „restaura" imediat exact selectorul VECHI, stricat — deci
 * reparația nu putea reuși niciodată. Override-ul se păstrează acum până când
 * AI Finder-ul întoarce un selector nou, validat în pagină (vezi `learn()`).
 */
function keepOverrideAfterAiFailure(providerId, slot) {
    const learned = selectors_1.selectors.learned(providerId, slot);
    if (!learned)
        return;
    healLog('AI finder nu a produs un selector pentru ' +
        providerId +
        '.' +
        slot +
        ' — păstrez override-ul existent („' +
        learned.selector +
        '", sursă ' +
        learned.how +
        ')' +
        (learned.locked ? ' [user-locked]' : ''));
}
/**
 * v2.5.20 (bug #44/#58): există în DOM conținut de răspuns pe care selectorii
 * curenți îl ratează? (text substanțial, în afara navigației, diferit de
 * mesajul tocmai trimis). Fără el, AI finder-ul nu are ce găsi — orice apel ar
 * consuma doar timeout-ul. Acoperă exact cazul „avem deja un selector static
 * care a mers în sesiuni anterioare": dacă elementul lui e prezent dar încă
 * gol (bila se randează), nu există conținut → nu-l înlocuim. Fail-open la
 * erori de evaluare, ca un bug de probe să nu blocheze repararea reală.
 */
async function hasResponseContentToFind(page, providerId, echoText) {
    try {
        const probe = await (0, selectors_1.getLastResponseText)(page, selectors_1.selectors.candidates(providerId, 'response'), true);
        const flat = String(probe || '').replace(/\s+/g, ' ').trim();
        if (flat.length < 60)
            return false;
        const echo = String(echoText || '').replace(/\s+/g, ' ').trim();
        // doar ecoul mesajului trimis (bula userului), nu un răspuns
        if (echo.length >= 40 && flat.includes(echo.slice(0, 40)))
            return false;
        return true;
    }
    catch (e) {
        log('AI finder probe failed: ' + (e?.message ?? String(e)));
        return true;
    }
}
async function bundledPrimarySelectorsWork(page, providerId, slots) {
    for (const slot of slots) {
        const selector = selectors_1.selectors.primary(providerId, slot);
        if (!selector)
            return false;
        try {
            const locator = page.locator(selector).first();
            if ((await locator.count()) === 0 ||
                !(await locator.isVisible()) ||
                !(await locator.isEnabled())) {
                return false;
            }
        }
        catch {
            return false;
        }
    }
    return true;
}
async function discoverForHealer(page, providerId, slot, echoText, opts = {}) {
    const slotKey = providerId + '.' + slot;
    // v2.5.44 (bug #101): slot cu selecție manuală → AI finder-ul nu propune nimic
    // v2.5.72 (FIX 2): după auto-unlock, `isLocked` e deja false, deci se continuă.
    if (selectors_1.selectors.isLocked(providerId, slot)) {
        healLog('skip ' + providerId + ':' + slot + ' — user-locked');
        tierLog('tier 2 (user) locked for ' + slotKey + ' — keeping the user selector');
        return null;
    }
    if (await isLoginOrCaptchaPage(page)) {
        log('skip ' + providerId + ' — login/CAPTCHA page detected');
        noteProviderNotReady(providerId, 'login/CAPTCHA page');
        return null;
    }
    // v2.5.72 (FIX 2): la auto-unlock NU ne oprim pentru că selectorul bundled
    // „pare" prezent — utilizatorul tocmai a avut un selector stricat pe slot.
    if (!opts.force && (await bundledPrimarySelectorsWork(page, providerId, [slot]))) {
        log('skip ' + providerId + ' — bundled ' + slot + ' selector works');
        return null;
    }
    const settings = finderSettings();
    if (!settings.enabled) {
        tierLog('tier 4 (AI Finder) skipped — mode=off');
        return null;
    }
    let host = '?';
    try {
        host = new URL(page.url()).origin;
    }
    catch {
        /* URL nevalid — folosim cheia '?' */
    }
    const key = providerId + ':' + slot + ':' + host;
    const last = recentAttempts.get(key) ?? 0;
    if (!opts.force && slot !== 'response' && Date.now() - last < AI_RETRY_MS) {
        log('AI finder: încercare recentă pentru ' + key + ' — sar peste');
        tierLog('tier 4 (AI Finder) rate-limited for ' + slotKey);
        return backupTier(providerId, slot);
    }
    if (inFlight.has(key)) {
        log('AI finder: deja în curs pentru ' + key);
        tierLog('tier 4 (AI Finder) already running for ' + slotKey);
        return null;
    }
    inFlight.add(key);
    recentAttempts.set(key, Date.now());
    const cancellationsBefore = getAIFinderCancellationCount();
    const startedAt = Date.now();
    // v2.5.20 (bug #44/#58): fără conținut de răspuns în DOM nu există nimic de
    // găsit — finder-ul ar arde timeout-ul complet (45–120s) pe un snapshot fără
    // bilă AI. Se întâmplă când bila nu e încă randată (selectorul static e
    // prezent, dar gol) sau pagina e goală. Îl lăsăm pe healer-ul de fingerprint
    // să rămână singura cale de reparare până apare conținut real.
    if (slot === 'response' && !(await hasResponseContentToFind(page, providerId, echoText))) {
        log('AI finder: no response content in the DOM yet — skipping for ' + key);
        tierLog('tier 4 (AI Finder) deferred for ' + slotKey + ' — no reply in the DOM yet');
        inFlight.delete(key);
        return backupTier(providerId, slot);
    }
    const tier4 = 'tier 4 (AI Finder ' +
        (settings.mode === 'browser'
            ? 'browser'
            : settings.mode === 'api-proxy'
                ? 'api-proxy'
                : 'ollama') +
        ')';
    tierLog(tier4 + ' for ' + slotKey + '...');
    try {
        const label = providers_1.PROVIDER_LABELS[providerId] || providerId;
        const discovered = await findSelectorsWithAI(page, label, [slot], {
            providerId,
            echoText,
            // v2.5.61 (FIX 6): reparație automată → niciun card în chat, doar log
            silent: true,
            // conținutul de răspuns a fost verificat mai sus (hasResponseContentToFind)
            replyPresent: slot === 'response' ? true : undefined
        });
        if (!discovered) {
            // v2.5.73 (FIX 4): nu ștergem override-ul dacă AI Finder-ul n-a produs nimic
            if (getAIFinderCancellationCount() === cancellationsBefore) {
                keepOverrideAfterAiFailure(providerId, slot);
            }
            return backupTier(providerId, slot);
        }
        const validated = await validateSelectors(page, discovered, { echoText });
        const applied = [];
        let found = null;
        for (const s of selectors_1.SLOTS) {
            const sel = validated[s];
            if (!sel)
                continue;
            const stored = selectors_1.selectors.learn(providerId, s, sel, 'ai', {
                confidence: validated.confidence,
                reasoning: validated.reasoning
            });
            if (stored) {
                applied.push(s + '=' + sel);
                if (s === slot) {
                    found = sel;
                    // v2.5.41 (bug #95): linia care lipsea — se vede negru pe alb ce s-a
                    // validat în pagină și s-a salvat
                    log('validated selector for ' + providerId + '.' + s + ': ' + sel);
                }
            }
            else {
                log('AI finder: respins la salvare (' + s + '): ' + sel);
            }
        }
        if (applied.length) {
            saveUserSelectors();
            log('AI finder: salvat ' +
                applied.join(', ') +
                ' (încredere ' +
                validated.confidence +
                ', „' +
                validated.reasoning +
                '”)');
        }
        // v2.5.73 (FIX 4): nimic util pentru slotul cerut (respins la validare /
        // la salvare) → păstrăm override-ul existent, vezi keepOverrideAfterAiFailure()
        if (!found) {
            if (discovered.finderId) {
                (0, ai_finder_events_1.publishAIFinderStatus)({
                    id: discovered.finderId,
                    providerId,
                    providerName: label,
                    phase: 'failed',
                    message: 'Repair failed. Manual intervention required.',
                    silent: true
                });
            }
            keepOverrideAfterAiFailure(providerId, slot);
            return backupTier(providerId, slot);
        }
        // v2.5.61 (FIX 3/6): reparația automată e completă — doar o linie de log
        log('repaired ' + slotKey + ' in ' +
            Math.max(1, Math.round((Date.now() - startedAt) / 1000)) + 's');
        // v2.5.72 (FIX 2): reparația unui selector user-locked auto-unlocked păstrează
        // user-lock-ul pe NOUL selector (și repornește contorul de eșecuri).
        if (opts.relock) {
            // learnLocked() golește contorul de eșecuri al selectorului (FIX 1/2)
            if (selectors_1.selectors.learnLocked(providerId, slot, found)) {
                saveUserSelectors();
                tierLog('auto-repaired ' + slotKey + ' via AI Finder, re-locked');
                (0, selectors_1.notifySelectorAlert)({ kind: 'repaired', key: slotKey, selector: found });
            }
            else {
                log('auto-repair: could not re-lock ' + slotKey + ' on "' + found + '"');
            }
        }
        return found;
    }
    catch (e) {
        log('AI finder a eșuat: ' + (e?.message ?? String(e)));
        keepOverrideAfterAiFailure(providerId, slot);
        return backupTier(providerId, slot);
    }
    finally {
        inFlight.delete(key);
    }
}
/**
 * v2.5.61 (FIX 7) — tier 5: dacă toți selectorii curenți s-au rupt, restaurăm
 * automat ultima versiune bună din `selectors-user.json.backup`. Se loghează
 * explicit (`tier 5 (backup) restored!`) ca să se vadă în Output → Freekit.
 */
function backupTier(providerId, slot) {
    const slotKey = providerId + '.' + slot;
    // v2.5.73 (FIX 4): dacă slotul are deja un override (inclusiv un user-lock pe
    // care tocmai l-am păstrat), tier 5 NU are voie să-l suprascrie cu o versiune
    // veche din backup — altfel „reparația" readuce exact selectorul stricat.
    const existing = selectors_1.selectors.learned(providerId, slot);
    if (existing) {
        tierLog('tier 5 (backup) skipped for ' + slotKey + ' — override kept (' + existing.selector + ')');
        return null;
    }
    if (backupRestored.has(slotKey)) {
        tierLog('tier 5 (backup) already restored ' + slotKey + ' in this session — skipping');
        return null;
    }
    backupRestored.add(slotKey);
    tierLog('tier 5 (backup) for ' + slotKey + '...');
    try {
        const restored = restoreFromBackup(providerId, slot);
        if (restored) {
            tierLog('tier 5 (backup) restored! ' + slotKey + ' -> ' + restored);
            return restored;
        }
        tierLog('tier 5 (backup) empty — nothing to restore for ' + slotKey);
    }
    catch (e) {
        log('backup restore failed: ' + (e?.message ?? String(e)));
        tierLog('tier 5 (backup) failed for ' + slotKey);
    }
    return null;
}
/* =========================================================================
 * v2.5.45 (bug #102) — DESCOPERIRE PROACTIVĂ + REPARAREA INPUTULUI
 *
 * Intrarea reactivă (discoverForHealer, de mai sus) rămâne pentru cazul „un
 * slot a căzut". Aici e a doua intrare, cerută de providers/base.ts:
 *   - la conectare (pagină încărcată + logat) → TOATE sloturile dintr-o dată;
 *   - la composer trunchiat → DOAR inputul, imediat, fără să așteptăm alt slot.
 * Rezultatele se salvează ca override-uri auto (how='ai', NU locked), deci o
 * descoperire ulterioară le poate înlocui; sloturile cu selecție manuală sunt
 * sărite (bug #101).
 * ========================================================================= */
/** Data configului de selectori activ (bundled/remote); 0 = necunoscută. */
function selectorConfigDate() {
    try {
        const t = Date.parse((0, selectors_1.configInfo)().updated || '');
        return Number.isFinite(t) ? t : 0;
    }
    catch {
        return 0;
    }
}
/**
 * Fix 1 / Fix 5 (bug #102): e momentul pentru o descoperire proactivă?
 * Declanșatorii: prima conectare la provider, selectorii (bundled/remote) mai
 * vechi de 30 de zile, o verificare anterioară eșuată sau o descoperire rămasă
 * în așteptare după login (Fix 2). Cache-ul de 7 zile (Fix 5) oprește
 * repetarea cât timp selectoarele încă funcționează.
 */
function discoveryDue(providerId, now) {
    if (discoveryFailed.has(providerId)) {
        return { due: true, reason: 'the last verification failed' };
    }
    if (pendingDiscovery.has(providerId)) {
        return { due: true, reason: 'pending after login' };
    }
    const last = discoveryDates.get(providerId);
    if (!last)
        return { due: true, reason: 'first connect' };
    const configDate = selectorConfigDate();
    if (configDate && now - configDate >= DISCOVERY_STALE_MS) {
        return { due: true, reason: 'the selectors are older than 30 days' };
    }
    const age = now - last;
    if (age >= DISCOVERY_CACHE_MS) {
        return { due: true, reason: 'the discovery cache expired (7 days)' };
    }
    return {
        due: false,
        reason: 'discovered ' + Math.round(age / 3600000) + 'h ago (cache: 7 days)'
    };
}
/**
 * Fix 2 (bug #102): pagina nu e încă gata (login, CAPTCHA, chat gol) — nu
 * consumăm analiza AI, dar ținem minte că descoperirea e datorată: la
 * următoarea conectare (după login / schimbarea URL-ului) se reia singură.
 * Cel mult MAX_PROACTIVE_ATTEMPTS încercări per sesiune.
 */
function noteProviderNotReady(providerId, reason) {
    const seen = pendingDiscovery.get(providerId) ?? 0;
    if (seen >= exports.MAX_PROACTIVE_ATTEMPTS)
        return;
    pendingDiscovery.set(providerId, seen + 1);
    const label = providers_1.PROVIDER_LABELS[providerId] || providerId;
    log(label + ' not ready (' + reason + ') — will retry after login');
}
/** Marchează descoperirea reușită: data (persistată) + curăță flagurile de eșec. */
function markDiscovered(providerId, at = Date.now()) {
    discoveryDates.set(providerId, at);
    discoveryFailed.delete(providerId);
    pendingDiscovery.delete(providerId);
    inputRepairFailures.delete(providerId);
    saveUserSelectors();
}
/** v2.5.45 (bug #102): data ultimei descoperiri pentru un provider (sau null). */
function discoveryDateFor(providerId) {
    return discoveryDates.get(providerId) ?? null;
}
/** Doar pentru teste: uită cache-ul de descoperire din sesiune. */
function resetDiscoveryState() {
    discoveryDates.clear();
    discoveryFailed.clear();
    pendingDiscovery.clear();
    proactiveAttempts.clear();
    inputRepairFailures.clear();
    inputRepairGaveUp.clear();
}
/**
 * Full discovery for Repair Selectors asks for all slots (input required,
 * other slots optional), validates them in the page and saves valid overrides
 * auto. Întoarce ce s-a rulat/salvat, ca apelantul (și comanda manuală) să
 * poată raporta. Fail-open: orice eroare lasă fluxul normal neatins.
 */
async function proactiveDiscover(page, providerId, opts = {}) {
    const label = providers_1.PROVIDER_LABELS[providerId] || providerId;
    const skip = (reason, pending = false) => ({
        ran: false,
        applied: [],
        reason,
        pending: pending || undefined
    });
    if (await isLoginOrCaptchaPage(page)) {
        log('skip ' + providerId + ' — login/CAPTCHA page detected');
        noteProviderNotReady(providerId, 'login/CAPTCHA page');
        return skip('login/CAPTCHA page detected', true);
    }
    if (!opts.force &&
        (await bundledPrimarySelectorsWork(page, providerId, [
            'input',
            'response',
            'newChat'
        ]))) {
        log('skip ' + providerId + ' — bundled selectors work');
        return skip('bundled selectors work');
    }
    const settings = finderSettings();
    if (!settings.enabled && !opts.force) {
        log('AI finder disabled (freekit.aiSelectorFinder.mode=off)');
        return skip('the AI finder is disabled (freekit.aiSelectorFinder.mode)');
    }
    // Fix 4 (bug #101): sloturile cu selecție manuală rămân ale utilizatorului.
    const slots = [];
    for (const s of selectors_1.SLOTS) {
        if (selectors_1.selectors.isLocked(providerId, s)) {
            log('skip ' + providerId + ':' + s + ' — user-locked');
            continue;
        }
        slots.push(s);
    }
    if (!slots.length) {
        log('skip ' + providerId + ' — every slot is user-locked');
        return skip('every slot is user-locked');
    }
    const now = Date.now();
    const due = discoveryDue(providerId, now);
    if (!opts.force && !due.due) {
        log('skip proactive discovery for ' + label + ' — ' + due.reason);
        return skip(due.reason);
    }
    // Fix 2: cel mult MAX_PROACTIVE_ATTEMPTS descoperiri per sesiune (o comandă
    // manuală explicită nu e limitată de asta).
    const attempts = proactiveAttempts.get(providerId) ?? 0;
    if (!opts.force && attempts >= exports.MAX_PROACTIVE_ATTEMPTS) {
        log('skip proactive discovery for ' + label + ' — ' + attempts + '/' +
            exports.MAX_PROACTIVE_ATTEMPTS + ' attempts already used in this session');
        return skip('the attempt limit for this session was reached');
    }
    // Fix 2: fără căsuță de chat în DOM nu avem ce descoperi (login/CAPTCHA) —
    // lăsăm descoperirea „în așteptare" și o reluăm după autentificare.
    if (!opts.force && !(await (0, selectors_1.inputAvailable)(page, providerId, 3000))) {
        noteProviderNotReady(providerId, 'login page?');
        return skip('the provider is not ready (login page?)');
    }
    proactiveAttempts.set(providerId, attempts + 1);
    log('running selector discovery for ' + label + (opts.force ? ' (manual)' : ''));
    try {
        const discovered = await findSelectorsWithAI(page, label, slots, {
            required: ['input'],
            onboarding: true,
            providerId,
            statusId: opts.statusId
        });
        if (!discovered) {
            discoveryFailed.add(providerId);
            log('proactive discovery failed for ' + label + ' — nothing usable');
            return { ran: true, applied: [], reason: 'the AI answered no usable selector' };
        }
        const validated = await validateSelectors(page, discovered);
        const applied = [];
        for (const s of selectors_1.SLOTS) {
            const sel = validated[s];
            if (!sel)
                continue;
            const stored = selectors_1.selectors.learn(providerId, s, sel, 'ai', {
                confidence: validated.confidence,
                reasoning: validated.reasoning
            });
            if (stored)
                applied.push(s + '=' + sel);
            else
                log('AI finder: respins la salvare (' + s + '): ' + sel);
        }
        if (!applied.length) {
            discoveryFailed.add(providerId);
            log('proactive discovery found nothing valid for ' + label + ' — manual fix may be needed');
            if (discovered.finderId) {
                (0, ai_finder_events_1.publishAIFinderStatus)({
                    id: discovered.finderId,
                    providerId,
                    providerName: label,
                    phase: 'failed',
                    message: 'Repair failed. Manual intervention required.'
                });
            }
            return { ran: true, applied: [], reason: 'no selector passed validation' };
        }
        markDiscovered(providerId);
        log('discovered ' + label + ' selectors: ' + applied.join(', '));
        return { ran: true, applied, reason: 'ok' };
    }
    catch (e) {
        discoveryFailed.add(providerId);
        log('proactive discovery failed for ' + label + ': ' + (e?.message ?? String(e)));
        return { ran: true, applied: [], reason: e?.message ?? String(e) };
    }
}
/**
 * Fix 3 (bug #102): composerul a trunchiat mesajul → inputul e suspect pentru
 * sesiunea curentă. Căutăm SPECIFIC căsuța de chat (fără să așteptăm ca alt
 * slot să pice) și, dacă găsim unul valid, îl salvăm ca override auto și îl
 * întoarcem apelantului pentru retrimiterea mesajului. După
 * MAX_INPUT_REPAIR_FAILURES eșecuri din sesiune ridicăm mâna (`gaveUp`) ca
 * chatView-ul să afișeze cardul „fix manual".
 */
async function repairChatInput(page, providerId) {
    const label = providers_1.PROVIDER_LABELS[providerId] || providerId;
    if (await isLoginOrCaptchaPage(page)) {
        log('skip ' + providerId + ' — login/CAPTCHA page detected');
        noteProviderNotReady(providerId, 'login/CAPTCHA page');
        return { selector: null, gaveUp: false, reason: 'login/CAPTCHA page detected' };
    }
    if (await bundledPrimarySelectorsWork(page, providerId, ['input'])) {
        log('skip ' + providerId + ' — bundled input selector works');
        return { selector: null, gaveUp: false, reason: 'bundled input selector works' };
    }
    // Fix 4 (bug #101): inputul cu selecție manuală nu se atinge.
    if (selectors_1.selectors.isLocked(providerId, 'input')) {
        log('skip ' + providerId + ':input — user-locked');
        return { selector: null, gaveUp: false, reason: 'input is user-locked' };
    }
    const settings = finderSettings();
    if (!settings.enabled) {
        return { selector: null, gaveUp: false, reason: 'the AI finder is disabled' };
    }
    let host = '?';
    try {
        host = new URL(page.url()).origin;
    }
    catch {
        /* URL nevalid — folosim cheia '?' */
    }
    const key = providerId + ':input-repair:' + host;
    if (inFlight.has(key)) {
        log('input repair already running for ' + key);
        return { selector: null, gaveUp: false, reason: 'a repair is already running' };
    }
    inFlight.add(key);
    const cancellationsBefore = getAIFinderCancellationCount();
    log('input suspect for ' + label + ' — asking the AI finder for the composer');
    try {
        const discovered = await findSelectorsWithAI(page, label, ['input'], {
            inputOnly: true,
            // v2.5.61 (FIX 6): reparația inputului e automată — fără carduri în chat
            silent: true
        });
        const sel = discovered?.input;
        if (sel) {
            // aceeași validare strictă ca la descoperire (vizibil, activ, acceptă
            // text, în viewport, în jumătatea de jos)
            const check = await validateChatInputSelector(page, sel);
            if (check.ok) {
                // v2.5.74 (FIX 2): salvăm varianta validată (ghilimele normalizate)
                const stored = selectors_1.selectors.learn(providerId, 'input', check.selector, 'ai', {
                    confidence: discovered?.confidence,
                    reasoning: discovered?.reasoning
                });
                if (stored) {
                    discoveryFailed.delete(providerId);
                    pendingDiscovery.delete(providerId);
                    inputRepairFailures.delete(providerId);
                    saveUserSelectors();
                    log('input repaired for ' + label + ': ' + check.selector);
                    return { selector: check.selector, gaveUp: false, reason: 'ok' };
                }
                log('input repair refused at save time (' + check.selector + ')');
            }
            else {
                log('input repair rejected (' + check.reason + '): ' + sel);
            }
        }
        else {
            log('input repair found nothing for ' + label);
        }
    }
    catch (e) {
        log('input repair failed for ' + label + ': ' + (e?.message ?? String(e)));
    }
    finally {
        inFlight.delete(key);
    }
    if (getAIFinderCancellationCount() !== cancellationsBefore) {
        return { selector: null, gaveUp: false, reason: 'repair cancelled by user' };
    }
    // Fix 3: au fost AI_FINDER_MAX_ATTEMPTS încercări de analiză pentru input,
    // toate ratate — numărăm eșecul de sesiune și, la al treilea, ridicăm mâna.
    const failures = (inputRepairFailures.get(providerId) ?? 0) + 1;
    inputRepairFailures.set(providerId, failures);
    const gaveUp = failures >= exports.MAX_INPUT_REPAIR_FAILURES && !inputRepairGaveUp.has(providerId);
    if (gaveUp) {
        inputRepairGaveUp.add(providerId);
        log('giving up on the input for ' + label + ' after ' + failures +
            '/' + exports.MAX_INPUT_REPAIR_FAILURES + ' failed repairs — manual fix required');
    }
    return {
        selector: null,
        gaveUp,
        reason: 'no valid chat input found (' + failures + '/' + exports.MAX_INPUT_REPAIR_FAILURES + ' failures)'
    };
}
/**
 * Fix 5 (bug #102): comanda manuală „Freekit: Repair Selectors" — pentru
 * providerul care are chatul deschis în Chrome, cu cache-ul ocolit.
 */
async function rediscoverSelectors(page, statusId) {
    let providerId = null;
    try {
        providerId = selectors_1.selectors.providerIdForUrl(page.url());
    }
    catch {
        /* pagină închisă */
    }
    if (!providerId) {
        if (statusId) {
            (0, ai_finder_events_1.publishAIFinderStatus)({
                id: statusId,
                providerId: '',
                providerName: 'provider',
                phase: 'failed',
                message: 'Repair failed. Open a supported provider chat and try again.'
            });
        }
        return { providerId: null, outcome: null };
    }
    const outcome = await proactiveDiscover(page, providerId, {
        force: true,
        statusId
    });
    if (statusId && !outcome.ran) {
        (0, ai_finder_events_1.publishAIFinderStatus)({
            id: statusId,
            providerId,
            providerName: providers_1.PROVIDER_LABELS[providerId] || providerId,
            phase: 'failed',
            message: outcome.reason
        });
    }
    return { providerId, outcome };
}
/* -------------------------------------------------------------------------
 * v2.5.72 (FIX 2-6) — AUTO-UNLOCK + COMENZI PENTRU SELECTORI USER-LOCKED
 *
 * Un selector user-locked stricat (site redesign) era testat, eșua, dar NU
 * putea fi reparat (healer-ul și AI Finder-ul îl ocoleau). Acum:
 *   - se numără eșecurile consecutive per selector (FIX 1);
 *   - la al 3-lea eșec iese din `_meta.locked` și AI Finder-ul e întrebat,
 *     cu re-lock pe noul selector la succes (FIX 2);
 *   - backup timestampat înainte de orice unlock (FIX 4).
 * ------------------------------------------------------------------------- */
/**
 * v2.5.72 (FIX 2/4): handlerul de auto-unlock. Backup-ul se ia ÎNAINTE de a
 * scoate selectorul din `_meta.locked`; apoi fișierul e rescris (fără el în
 * `_meta.locked`, dar cu selectorul păstrat ca override obișnuit).
 */
function onUserLockExhausted(providerId, slot, count) {
    const key = providerId + '.' + slot;
    backupTimestampedUserSelectors();
    if (!selectors_1.selectors.autoUnlockUserLock(providerId, slot, count)) {
        log('auto-unlock: ' + key + ' is no longer locked — nothing to do');
        return;
    }
    saveUserSelectors();
}
/**
 * v2.5.72 (FIX 2): reparația unui selector user-locked auto-unlocked — AI
 * Finder-ul e întrebat țintit pentru slot, iar la succes noul selector e
 * re-lockuit (user-lock păstrat) și contorul de eșecuri repornește.
 */
async function repairUserLockedSelector(page, providerId, slot) {
    if (!finderSettings().enabled) {
        tierLog('auto-unlock: AI Finder disabled (mode=off) for ' + providerId + '.' + slot);
        return null;
    }
    return discoverForHealer(page, providerId, slot, undefined, { force: true, relock: true });
}
/**
 * v2.5.72 (FIX 3): comanda manuală „Freekit: Unlock broken selectors" —
 * testează funcțional fiecare selector user-locked (toți providerii sau doar
 * unul) și, pe cele stricate, le scoate din `_meta.locked` și cere AI
 * Finder-ului să le repare. Log: `[selectors] unlocked N broken selectors`.
 */
async function unlockBrokenUserSelectors(getPage, opts = {}) {
    const outcome = { tested: 0, unlocked: 0, repaired: 0 };
    const providers = opts.provider ? [opts.provider] : exports.USER_LOCK_PROVIDERS;
    for (const pid of providers) {
        const keys = selectors_1.selectors.lockedKeys().filter((k) => k.startsWith(pid + '.'));
        if (!keys.length)
            continue;
        let page = null;
        try {
            page = await getPage(pid);
        }
        catch (e) {
            log('unlock: could not get the page for ' + pid + ': ' + (e?.message ?? String(e)));
        }
        if (!page) {
            tierLog('unlock: no open tab for ' + pid + ' — skipped');
            continue;
        }
        for (const key of keys) {
            const parsed = splitSlotKey(key);
            if (!parsed)
                continue;
            const entry = selectors_1.selectors.learned(parsed.provider, parsed.slot);
            if (!entry?.locked)
                continue;
            outcome.tested++;
            let ok = false;
            try {
                ok = await functionallyValidateSlot(page, parsed.provider, parsed.slot, entry.selector);
            }
            catch (e) {
                log('unlock: functional test errored for ' + key + ': ' + (e?.message ?? String(e)));
            }
            if (ok) {
                tierLog('unlock: ' + key + ' still works — kept locked');
                continue;
            }
            backupTimestampedUserSelectors();
            if (!selectors_1.selectors.unlockUserLock(parsed.provider, parsed.slot))
                continue;
            outcome.unlocked++;
            saveUserSelectors();
            if (await repairUserLockedSelector(page, parsed.provider, parsed.slot))
                outcome.repaired++;
        }
    }
    tierLog('unlocked ' + outcome.unlocked + ' broken selectors');
    return outcome;
}
/**
 * v2.5.72 (FIX 6): resetează contoarele de eșec (scope: toți providerii sau
 * doar unul) și rescrie `selectors-user.json`.
 */
function resetUserLockFailures(provider) {
    const removed = selectors_1.selectors.resetLockFailures(provider);
    saveUserSelectors();
    tierLog('failure counters reset (scope: ' + (provider || 'all') + ')');
    return removed;
}
/** Înregistrează fallback-ul AI + încarcă selectors-user.json (la activate()). */
function initAISelectorFinder(storageFsPath, extensionVersion = '') {
    storageDir = storageFsPath || null;
    selectors_1.selectors.setUserFileWriter(saveUserSelectors);
    (0, selectors_1.setAIFinder)(discoverForHealer);
    // Reactive input repair is called by providers/base.ts; full discovery is
    // available only through the explicit Repair Selectors command.
    (0, selectors_1.setProactiveDiscovery)(proactiveDiscover);
    (0, selectors_1.setInputRepair)(repairChatInput);
    (0, selectors_1.setNotReadyNotifier)(noteProviderNotReady);
    // v2.5.61 (FIX 1): healer-ul de fingerprint testează funcțional candidatul
    // înainte să-l salveze (aceleași criterii ca validateSelectors).
    (0, selectors_1.setFunctionalValidator)(functionallyValidateSlot);
    // v2.5.72 (FIX 2/4): la al 3-lea eșec al unui selector user-locked → backup
    // timestampat + scoatere din `_meta.locked` + reparație țintită prin AI Finder
    // (cu re-lock pe noul selector).
    selectors_1.selectors.setUserLockFailureHandler(onUserLockExhausted);
    (0, selectors_1.setUserLockRepair)(repairUserLockedSelector);
    loadUserSelectorsFromDisk();
    // v2.5.65 (FIX 5): la update de versiune, selectorii auto invalizi (ex:
    // claude.response învățat greșit) sunt șterși automat din selectors-user.json.
    runSelectorMigration(extensionVersion);
    log('AI selector finder pregătit — fișier: ' +
        (userSelectorsFilePath() || '(fără globalStorage)') +
        ', mode=' + finderSettings().mode);
}
//# sourceMappingURL=ai-selector-finder.js.map