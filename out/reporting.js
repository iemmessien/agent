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
exports.ReportingService = exports.ReportingClient = exports.DEFAULT_ENDPOINT = exports.normalizeHost = void 0;
exports.applyServerSelectors = applyServerSelectors;
exports.probeProviderSelectors = probeProviderSelectors;
const vscode = __importStar(require("vscode"));
const crypto = __importStar(require("crypto"));
const log_1 = require("./log");
const selectors_1 = require("./selectors");
const ai_selector_finder_1 = require("./ai-selector-finder");
// v2.5.11 (bug #34): logica pură (URL + clasificare rapoarte) trăiește în
// selectorHealth.ts, fără `vscode`/Playwright, ca să poată fi testată izolat.
const selectorHealth_1 = require("./selectorHealth");
Object.defineProperty(exports, "normalizeHost", { enumerable: true, get: function () { return selectorHealth_1.normalizeHost; } });
const log = (msg) => (0, log_1.logLine)('reporting', msg);
/* =========================================================================
 * v2.4.0 — FREEKIT REPORTING SERVER (self-maintaining integration)
 *
 * Extensia vorbește cu serverul de raportare (implicit api.builderweb.app):
 *   1) înregistrare o singură dată  → apiKey (globalState), idempotent;
 *   2) health check periodic        → verifică selectorii pe tab-urile deja
 *      deschise, repară local (fingerprint + AI) și, dacă tot eșuează,
 *      trimite un raport către server;
 *   3) fetch periodic de selectori   → aplică ce a învățat serverul din
 *      raportările celorlalți clienți.
 *
 * Toate operațiile sunt best-effort: nicio eroare de rețea nu afectează
 * funcționarea normală a extensiei.
 * ========================================================================= */
const KEYS = {
    installationId: 'freekit.reporting.installationId',
    apiKey: 'freekit.reporting.apiKey',
    lastSelectorsRevision: 'freekit.reporting.lastSelectorsRevision',
    lastHealthCheck: 'freekit.reporting.lastHealthCheck',
    lastSelectorFetch: 'freekit.reporting.lastSelectorFetch'
};
exports.DEFAULT_ENDPOINT = 'https://api.builderweb.app';
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_HEALTH_HOURS = 6;
const DEFAULT_SELECTORS_HOURS = 24;
const MAX_DOM_SNAPSHOT_CHARS = 12_000;
/** Sloturile verificate de health check (response e dependent de conținut,
 *  stopButton există doar în timpul generării → nu au sens aici). */
const HEALTH_SLOTS = ['input', 'newChat'];
/** v2.5.11 (bug #34): cât așteptăm SPA-ul să randeze input-ul înainte de raport. */
const HEALTH_WAIT_MS = 5000;
/** v2.5.11 (bug #34): timeout pentru navigarea la pagina aplicației. */
const APP_NAV_TIMEOUT_MS = 10_000;
/* ---------------- helpers ---------------- */
function cfg() {
    return vscode.workspace.getConfiguration('freekit');
}
function clampHours(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > 24 * 30)
        return fallback;
    return n;
}
async function request(url, init, timeoutMs = REQUEST_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(500, timeoutMs));
    try {
        return await fetch(url, { ...init, signal: ctrl.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
function hostOfUrl(url) {
    try {
        return (0, selectorHealth_1.normalizeHost)(new URL(url).host);
    }
    catch {
        return (0, selectorHealth_1.normalizeHost)(url);
    }
}
/** URL-ul paginii, fără excepție dacă pagina e în tranziție. */
function pageUrl(page) {
    try {
        return page.url();
    }
    catch {
        return '';
    }
}
/** Tab-urile deja deschise în Chrome (CDP /json) — fără a porni browserul. */
async function openTabHosts(port) {
    const hosts = new Set();
    try {
        const res = await request('http://127.0.0.1:' + port + '/json', {}, 3000);
        if (!res.ok)
            return hosts;
        const tabs = (await res.json());
        for (const tab of Array.isArray(tabs) ? tabs : []) {
            const host = hostOfUrl(String(tab?.url || ''));
            if (host)
                hosts.add(host);
        }
    }
    catch {
        /* CDP indisponibil — health check-ul se sare peste */
    }
    return hosts;
}
/* ---------------- aplicarea selectorilor veniți de la server ---------------- */
function pickSelector(value) {
    if (typeof value === 'string')
        return value.trim() || null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const s = pickSelector(item);
            if (s)
                return s;
        }
        return null;
    }
    if (value && typeof value === 'object') {
        const o = value;
        return pickSelector(o.selector ?? o.value ?? o.css ?? o.primary);
    }
    return null;
}
/** Extrage perechile (slot, selector) dintr-o intrare a serverului. */
function slotsFromEntry(entry) {
    const out = [];
    const direct = pickSelector(entry.selector ?? entry.value ?? entry.css);
    if (direct && selectors_1.SLOTS.includes(entry.slot)) {
        out.push({ slot: entry.slot, selector: direct });
    }
    const map = entry.selectors && typeof entry.selectors === 'object' && !Array.isArray(entry.selectors)
        ? entry.selectors
        : entry;
    for (const slot of selectors_1.SLOTS) {
        if (out.some((o) => o.slot === slot))
            continue;
        const sel = pickSelector(map?.[slot]);
        if (sel)
            out.push({ slot, selector: sel });
    }
    return out;
}
function providerForDomain(domain) {
    const d = (0, selectorHealth_1.normalizeHost)(domain);
    if (!d)
        return null;
    for (const pid of selectors_1.selectors.info().providers) {
        const h = (0, selectorHealth_1.normalizeHost)(selectorUrl(pid));
        if (!h)
            continue;
        if (h === d || h.endsWith('.' + d) || d.endsWith('.' + h))
            return pid;
    }
    return null;
}
function selectorUrl(providerId) {
    try {
        return selectors_1.selectors.url(providerId);
    }
    catch {
        return '';
    }
}
/**
 * Aplică lista de selectori primită de la server (best-effort).
 * Acceptă atât intrări `{ domain, slot, selector }`, cât și `{ domain, input,
 * response, newChat, stopButton }` sau `{ provider, selectors: {...} }`.
 * Validarea (fragil/blacklist/UI chrome) rămâne în `selectors.learn()`.
 */
function applyServerSelectors(list) {
    const applied = [];
    if (!Array.isArray(list) || !list.length)
        return applied;
    const known = selectors_1.selectors.info().providers;
    for (const raw of list) {
        if (!raw || typeof raw !== 'object')
            continue;
        const entry = raw;
        let pid = typeof entry.provider === 'string' && known.includes(entry.provider)
            ? entry.provider
            : null;
        const domain = typeof entry.domain === 'string'
            ? entry.domain
            : typeof entry.host === 'string'
                ? entry.host
                : '';
        if (!pid && domain)
            pid = providerForDomain(domain);
        if (!pid) {
            log('selectors: server entry ignored — unknown domain "' + domain + '"');
            continue;
        }
        for (const { slot, selector } of slotsFromEntry(entry)) {
            if (selectors_1.selectors.learn(pid, slot, selector, 'server')) {
                applied.push({ provider: pid, slot, selector });
            }
        }
    }
    if (applied.length) {
        log('selectors: applied ' +
            applied.length +
            ' server update(s): ' +
            applied.map((a) => a.provider + '.' + a.slot).join(', '));
    }
    return applied;
}
/* ---------------- health check ---------------- */
async function selectorUsable(page, selector) {
    try {
        const loc = page.locator(selector).first();
        if ((await loc.count()) === 0)
            return false;
        return await loc.isVisible();
    }
    catch {
        return false;
    }
}
async function anyUsable(page, sels) {
    for (const sel of sels) {
        if (await selectorUsable(page, sel))
            return true;
    }
    return false;
}
/**
 * Verifică selectorii unui provider pe pagina dată: dacă sloturile critice nu
 * se rezolvă, încearcă repararea locală (fingerprint + AI) și, dacă nici așa
 * nu există un selector funcțional, întoarce rapoartele de trimis la server.
 *
 * v2.5.11 (bug #34): `waitMs` = cât așteptăm SPA-ul să randeze (echivalentul
 * `page.waitForSelector`), iar clasificarea trece prin `buildProbeReports`:
 * dacă NICIUN slot critic nu există în DOM → un singur `wrong_page`, nu două
 * rapoarte `not_found`.
 */
async function probeProviderSelectors(page, providerId, opts = {}) {
    const url = pageUrl(page);
    const domain = hostOfUrl(url);
    let snapshot;
    let snapshotTaken = false;
    const snapshotOnce = async () => {
        if (!opts.shareDomSnapshot)
            return undefined;
        if (!snapshotTaken) {
            snapshotTaken = true;
            try {
                // v2.5.41: `full` = snapshot-ul complet curățat (ca înainte de filtrarea
                // pentru AI finder) — raportul de bug are nevoie de toată structura
                snapshot = (await (0, ai_selector_finder_1.captureCleanDom)(page, { full: true })).slice(0, MAX_DOM_SNAPSHOT_CHARS);
            }
            catch (e) {
                log('dom snapshot failed: ' + (e?.message ?? String(e)));
            }
        }
        return snapshot;
    };
    const probes = [];
    for (const slot of HEALTH_SLOTS) {
        const sels = selectors_1.selectors.candidates(providerId, slot);
        if (!sels.length)
            continue;
        // v2.5.11 (bug #34): SPA-ul poate avea nevoie de câteva secunde — nu
        // declarăm slotul lipsă cât timp pagina se încarcă.
        if (await (0, selectorHealth_1.waitForAny)(() => anyUsable(page, sels), opts.waitMs ?? 0)) {
            probes.push({ slot, candidates: sels, usable: true, present: true });
            continue;
        }
        // auto-heal local: exact aceeași cale ca la rularea normală
        let healed = null;
        try {
            healed = await (0, selectors_1.healSlot)(page, providerId, slot);
        }
        catch (e) {
            log('heal failed (' + providerId + '.' + slot + '): ' + (e?.message ?? String(e)));
        }
        if (healed && (await selectorUsable(page, healed))) {
            probes.push({ slot, candidates: sels, usable: true, present: true, healed });
            continue;
        }
        probes.push({
            slot,
            candidates: sels,
            usable: false,
            present: await (0, selectors_1.anySelectorPresent)(page, sels),
            healed
        });
    }
    const reports = (0, selectorHealth_1.buildProbeReports)({ domain, providerId, url, slots: probes });
    for (const r of reports) {
        // v2.5.11 (bug #34): snapshot-ul se atașează doar rapoartelor per-slot — un
        // snapshot de pe o pagină non-app (`wrong_page`) nu are ce învăța serverul.
        if (r.failureType !== 'wrong_page')
            r.domSnapshot = await snapshotOnce();
    }
    return reports;
}
/* ---------------- clientul de raportare ---------------- */
class ReportingClient {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    /** URL-ul serverului (freekit.reporting.endpoint). */
    get endpoint() {
        return String(cfg().get('reporting.endpoint', exports.DEFAULT_ENDPOINT) || exports.DEFAULT_ENDPOINT).replace(/\/+$/, '');
    }
    get enabled() {
        return cfg().get('reporting.enabled', true);
    }
    get shareDomSnapshot() {
        return cfg().get('reporting.shareDomSnapshot', false);
    }
    get healthCheckEnabled() {
        return cfg().get('reporting.healthCheck', true);
    }
    get healthCheckIntervalMs() {
        const hours = clampHours(cfg().get('reporting.healthCheckIntervalHours', DEFAULT_HEALTH_HOURS), DEFAULT_HEALTH_HOURS);
        return hours * 60 * 60 * 1000;
    }
    get selectorsIntervalMs() {
        const hours = clampHours(cfg().get('reporting.selectorsIntervalHours', DEFAULT_SELECTORS_HOURS), DEFAULT_SELECTORS_HOURS);
        return hours * 60 * 60 * 1000;
    }
    get hasApiKey() {
        return !!this.ctx.globalState.get(KEYS.apiKey);
    }
    get installationIdValue() {
        return this.ctx.globalState.get(KEYS.installationId);
    }
    get lastHealthCheckAt() {
        return this.ctx.globalState.get(KEYS.lastHealthCheck, 0);
    }
    get lastSelectorFetchAt() {
        return this.ctx.globalState.get(KEYS.lastSelectorFetch, 0);
    }
    get selectorsRevision() {
        return this.ctx.globalState.get(KEYS.lastSelectorsRevision, 0);
    }
    async getOrCreateInstallationId() {
        let id = this.ctx.globalState.get(KEYS.installationId);
        if (!id) {
            id = crypto.randomUUID();
            await this.ctx.globalState.update(KEYS.installationId, id);
            log('created installationId');
        }
        return id;
    }
    /** Register cu serverul. Salvează apiKey. Idempotent. */
    async ensureRegistered() {
        if (!this.enabled)
            return null;
        const apiKey = this.ctx.globalState.get(KEYS.apiKey);
        if (apiKey)
            return apiKey;
        try {
            const installationId = await this.getOrCreateInstallationId();
            const version = vscode.extensions.getExtension('builderweb.freekit')?.packageJSON.version ??
                this.ctx.extension.packageJSON.version;
            const res = await request(`${this.endpoint}/api/v1/extensions/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ installationId, name: vscode.env.appName, version })
            });
            if (!res.ok) {
                log(`register failed: ${res.status}`);
                return null;
            }
            const data = (await res.json());
            if (!data?.apiKey) {
                log('register failed: response has no apiKey');
                return null;
            }
            await this.ctx.globalState.update(KEYS.apiKey, data.apiKey);
            log(`registered: extensionId=${data.extensionId}${data.rotated ? ' (rotated)' : ''}`);
            return data.apiKey;
        }
        catch (e) {
            log(`register error: ${e.message}`);
            return null;
        }
    }
    /** Șterge identitatea locală (apiKey + installationId) → re-înregistrare. */
    async resetIdentity() {
        await this.ctx.globalState.update(KEYS.apiKey, undefined);
        await this.ctx.globalState.update(KEYS.installationId, undefined);
        log('identity reset (apiKey + installationId removed)');
    }
    /** Trimite un raport pentru selector stricat. Best-effort. */
    async report(payload) {
        if (!this.enabled)
            return;
        const apiKey = await this.ensureRegistered();
        if (!apiKey)
            return;
        try {
            const body = {
                reports: [
                    {
                        domain: payload.domain,
                        selector: payload.selector,
                        failureType: payload.failureType,
                        message: payload.message,
                        url: payload.url,
                        // v2.5.11 (bug #34): sloturile vizate (opționale — serverele vechi
                        // le ignoră; `undefined` dispare la JSON.stringify)
                        slot: payload.slot,
                        slots: payload.slots
                    }
                ]
            };
            if (payload.domSnapshot)
                body.reports[0].domSnapshot = payload.domSnapshot;
            const res = await request(`${this.endpoint}/api/v1/reports`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-freekit-key': apiKey
                },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                log(`reported: ${JSON.stringify(data).slice(0, 120)}`);
            }
            else {
                log(`report failed: ${res.status}`);
            }
        }
        catch (e) {
            log(`report error: ${e.message}`);
        }
    }
    /**
     * Fetch selectori noi de la server (max 1× per intervală, implicit 24h).
     * Returnează lista nouă sau null.
     */
    async fetchUpdatedSelectors(force = false) {
        if (!this.enabled)
            return null;
        const last = this.ctx.globalState.get(KEYS.lastSelectorFetch, 0);
        if (!force && Date.now() - last < this.selectorsIntervalMs)
            return null;
        const apiKey = await this.ensureRegistered();
        if (!apiKey)
            return null;
        try {
            const since = this.ctx.globalState.get(KEYS.lastSelectorsRevision, 0);
            const res = await request(`${this.endpoint}/api/v1/selectors?since=${since}`, {
                headers: { 'x-freekit-key': apiKey }
            });
            await this.ctx.globalState.update(KEYS.lastSelectorFetch, Date.now());
            if (res.status === 304) {
                log('selectors: up to date');
                return null;
            }
            if (!res.ok) {
                log(`selectors fetch failed: ${res.status}`);
                return null;
            }
            const data = (await res.json());
            await this.ctx.globalState.update(KEYS.lastSelectorsRevision, data.revision);
            log(`selectors: fetched revision=${data.revision}, count=${data.selectors?.length ?? 0}`);
            return Array.isArray(data.selectors) ? data.selectors : null;
        }
        catch (e) {
            log(`selectors fetch error: ${e.message}`);
            return null;
        }
    }
    shouldHealthCheck(now = Date.now()) {
        return now - this.lastHealthCheckAt >= this.healthCheckIntervalMs;
    }
    async markHealthCheck(now = Date.now()) {
        await this.ctx.globalState.update(KEYS.lastHealthCheck, now);
    }
    /** Text scurt despre starea integrării (pentru diagnostics / comandă). */
    statusText() {
        if (!this.enabled)
            return 'disabled (freekit.reporting.enabled = false)';
        const last = this.lastHealthCheckAt;
        return ((this.hasApiKey ? 'registered' : 'not registered yet') +
            ' | endpoint: ' +
            this.endpoint +
            ' | revision: ' +
            this.selectorsRevision +
            ' | last health check: ' +
            (last ? new Date(last).toLocaleString() : 'never') +
            ' | last selectors fetch: ' +
            (this.lastSelectorFetchAt ? new Date(this.lastSelectorFetchAt).toLocaleString() : 'never') +
            ' | DOM snapshot: ' +
            (this.shareDomSnapshot ? 'on' : 'off'));
    }
}
exports.ReportingClient = ReportingClient;
/**
 * Programează integrarea: înregistrare la pornire, health check la 6h și
 * fetch de selectori la 24h (intervalele sunt configurabile). Toate
 * operațiile sunt best-effort și nu blochează activarea extensiei.
 */
class ReportingService {
    client;
    browser;
    notify;
    timers = [];
    disposed = false;
    healthRunning = false;
    constructor(ctx, opts) {
        this.client = new ReportingClient(ctx);
        this.browser = opts.browser;
        this.notify = opts.notify ?? (() => { });
    }
    start() {
        if (this.disposed)
            return;
        if (!this.client.enabled) {
            log('integration disabled by setting — not starting');
            return;
        }
        void this.client.ensureRegistered();
        if (this.client.healthCheckEnabled) {
            const healthMs = this.client.healthCheckIntervalMs;
            // prima verificare devreme, dar nu în timpul pornirii VS Code
            this.timers.push(setTimeout(() => void this.healthTick(), Math.min(healthMs, 3 * 60_000)));
            this.timers.push(setInterval(() => void this.healthTick(), healthMs));
        }
        const selMs = this.client.selectorsIntervalMs;
        this.timers.push(setTimeout(() => void this.selectorTick(), Math.min(selMs, 60_000)));
        this.timers.push(setInterval(() => void this.selectorTick(), selMs));
    }
    /** Descarcă (dacă e cazul) și aplică selectorii noi de la server. */
    async fetchSelectors(force = false) {
        if (this.disposed)
            return [];
        const list = await this.client.fetchUpdatedSelectors(force);
        if (!list || !list.length)
            return [];
        return applyServerSelectors(list);
    }
    /**
     * v2.5.11 (bug #34): aduce tab-ul pe pagina aplicației providerului înainte
     * de probă (timeout scurt). Eșecul duce la skip — nu la rapoarte false.
     */
    async openAppPage(page, appUrl) {
        if (!appUrl)
            return false;
        try {
            await page.goto(appUrl, {
                waitUntil: 'domcontentloaded',
                timeout: APP_NAV_TIMEOUT_MS
            });
            return true;
        }
        catch (e) {
            log('health: navigation to ' + appUrl + ' failed — ' + (e?.message ?? String(e)));
            return false;
        }
    }
    /**
     * Verifică selectorii pe tab-urile deja deschise: repară local și, dacă
     * reparația eșuează, trimite rapoartele către server.
     */
    async runHealthCheck(force = false) {
        const outcome = { checkedProviders: [], failures: [] };
        if (this.disposed || !this.client.enabled)
            return outcome;
        if (this.healthRunning)
            return outcome;
        if (!force && !this.client.shouldHealthCheck())
            return outcome;
        this.healthRunning = true;
        try {
            await this.client.markHealthCheck();
            if (!(await this.browser.isRunning())) {
                log('health: browser is not running — skipped');
                return outcome;
            }
            const apiKey = await this.client.ensureRegistered();
            if (!apiKey) {
                log('health: not registered — skipped');
                return outcome;
            }
            const hosts = await openTabHosts(this.browser.options().port);
            if (!hosts.size) {
                log('health: no tab open — skipped');
                return outcome;
            }
            for (const pid of selectors_1.selectors.info().providers) {
                const appUrl = selectorUrl(pid);
                const host = (0, selectorHealth_1.normalizeHost)(appUrl);
                if (!host || !hosts.has(host))
                    continue;
                let page;
                try {
                    page = await this.browser.ensureOpen(host);
                }
                catch (e) {
                    log('health: could not open the page for ' + pid + ': ' + (e?.message ?? String(e)));
                    continue;
                }
                // siguranță: nu verificăm un tab greșit (fals-pozitive)
                if (!page || (0, selectorHealth_1.normalizeHost)(hostOfUrl(pageUrl(page))) !== host)
                    continue;
                // v2.5.11 (bug #34): verifică PAGINA aplicației, nu doar hostul — un
                // tab pe landing / `/share/...` / eroare (același host) nu are niciun
                // element al aplicației și producea 2 rapoarte `not_found` false.
                // Excepție: alte rute valide ale aplicației (ex. Claude `/chat/<id>`,
                // care nu e `selectors.url`) — dacă input-ul e deja utilizabil acolo,
                // NU mutăm tab-ul utilizatorului.
                if (!(0, selectorHealth_1.isAppPage)(pageUrl(page), appUrl)) {
                    const inputSels = selectors_1.selectors.candidates(pid, 'input');
                    const looksLikeApp = inputSels.length > 0 && (await anyUsable(page, inputSels));
                    if (!looksLikeApp) {
                        const moved = await this.openAppPage(page, appUrl);
                        if (!moved || !(0, selectorHealth_1.isAppPage)(pageUrl(page), appUrl)) {
                            log('health check: skipping ' + pid + ' — wrong page (' + pageUrl(page) + ')');
                            continue;
                        }
                    }
                }
                outcome.checkedProviders.push(pid);
                const found = await probeProviderSelectors(page, pid, {
                    shareDomSnapshot: this.client.shareDomSnapshot,
                    waitMs: HEALTH_WAIT_MS
                });
                for (const failure of found) {
                    log('health: ' + pid + ' → ' + failure.failureType + ' (' + failure.selector + ')');
                    outcome.failures.push(failure);
                    await this.client.report(failure);
                }
            }
            log('health check done — providers checked: ' +
                (outcome.checkedProviders.join(', ') || 'none') +
                ', failures: ' +
                outcome.failures.length);
            return outcome;
        }
        catch (e) {
            log('health check error: ' + (e?.message ?? String(e)));
            return outcome;
        }
        finally {
            this.healthRunning = false;
        }
    }
    async healthTick() {
        try {
            await this.runHealthCheck();
        }
        catch (e) {
            log('health tick error: ' + (e?.message ?? String(e)));
        }
    }
    async selectorTick() {
        try {
            const applied = await this.fetchSelectors();
            if (applied.length) {
                this.notify('☁️ Freekit: ' +
                    applied.length +
                    ' selector fix(es) received from the server (' +
                    applied.map((a) => a.provider + '.' + a.slot).join(', ') +
                    ').');
            }
        }
        catch (e) {
            log('selector tick error: ' + (e?.message ?? String(e)));
        }
    }
    dispose() {
        this.disposed = true;
        for (const timer of this.timers) {
            clearTimeout(timer);
            clearInterval(timer);
        }
        this.timers = [];
    }
}
exports.ReportingService = ReportingService;
//# sourceMappingURL=reporting.js.map