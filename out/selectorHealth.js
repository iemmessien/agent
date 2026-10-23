"use strict";
/**
 * v2.5.11 (bug #34): logica PURĂ a health check-ului de selectoare — separată
 * de Playwright / vscode ca să poată fi testată izolat (vezi test-health-check).
 *
 * Problema raportată de telemetrie: pe un tab aflat pe altă pagină de sub
 * hostul providerului (landing, `/share/…`, eroare) DOM-ul nu conține niciun
 * element al aplicației, iar check-ul trimitea DOUĂ rapoarte `not_found` false
 * (input + newChat). Acum:
 *   - se verifică URL-ul aplicației (host + path), nu doar hostul;
 *   - dacă niciun slot critic nu există în DOM → UN singur raport `wrong_page`,
 *     nu câte unul pe slot.
 *
 * Modulul NU importă `vscode` și NU atinge DOM-ul — doar compară URL-uri și
 * transformă rezultatele probelor în rapoarte.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeHost = normalizeHost;
exports.isAppPage = isAppPage;
exports.waitForAny = waitForAny;
exports.buildProbeReports = buildProbeReports;
/** Host normalizat (fără protocol/port/path, fără „www.”) — pentru mapare. */
function normalizeHost(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^\/\//, '')
        .replace(/[\/?#].*$/, '')
        .replace(/:\d+$/, '')
        .replace(/^www\./, '');
}
function trimTrailingSlash(pathname) {
    return String(pathname || '').replace(/\/+$/, '');
}
/**
 * v2.5.23 (bug #61): căile de autentificare ale providerilor — pe ele NU există
 * elementele aplicației, deci nu sunt „pagina aplicației" nici măcar când
 * `appUrl` e rădăcina hostului (DeepSeek `/sign_in`, ChatGPT `/auth/login`).
 */
const AUTH_PATHS = [
    '/sign_in', '/signin', '/sign-in',
    '/login', '/log-in',
    '/signup', '/sign-up', '/register',
    '/auth/', '/oauth'
];
/**
 * `true` dacă `currentUrl` e pagina aplicației providerului (`appUrl`):
 * același host ȘI același path (sau un sub-path al lui, ex. `/app/<id>`).
 * Rădăcina (`/`) e acceptată când `appUrl` e chiar rădăcina (ex. DeepSeek),
 * mai puțin paginile de autentificare (v2.5.23, bug #61: `/sign_in` era
 * raportat ca pagină validă → health check-ul trimitea `not_found` false).
 */
function isAppPage(currentUrl, appUrl) {
    if (!currentUrl || !appUrl)
        return false;
    try {
        const cur = new URL(currentUrl);
        const app = new URL(appUrl);
        if (normalizeHost(cur.host) !== normalizeHost(app.host))
            return false;
        const appPath = trimTrailingSlash(app.pathname);
        const curPath = trimTrailingSlash(cur.pathname);
        if (appPath === '') {
            // v2.5.23 (bug #61): chiar și pe root, excludem paginile de auth
            const lowerCur = curPath.toLowerCase();
            if (AUTH_PATHS.some((p) => lowerCur === p || lowerCur.startsWith(p))) {
                return false;
            }
            return true; // provider cu aplicația pe rădăcină
        }
        return curPath === appPath || curPath.startsWith(appPath + '/');
    }
    catch {
        return false;
    }
}
/**
 * Așteaptă ca `check` să întoarcă `true`, până la `timeoutMs` (poll `stepMs`).
 * Echivalentul `page.waitForSelector`-ului, dar injectabil (testabil).
 */
async function waitForAny(check, timeoutMs, stepMs = 250) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    for (;;) {
        if (await check())
            return true;
        if (Date.now() >= deadline)
            return false;
        await new Promise((resolve) => setTimeout(resolve, stepMs));
    }
}
/**
 * Transformă probele în rapoarte:
 *   - toate sloturile OK → niciun raport;
 *   - NICIUN slot critic prezent în DOM → UN singur `wrong_page` (pagina nu e
 *     aplicația: landing / share / eroare / SPA nedesenată), nu 2 × not_found;
 *   - altfel → câte un raport per slot (`hidden` dacă elementul există dar nu
 *     e utilizabil, `not_found` dacă nu există deloc).
 */
function buildProbeReports(args) {
    const failed = args.slots.filter((s) => !s.usable);
    if (!failed.length)
        return [];
    if (failed.length > 1 && failed.every((s) => !s.present)) {
        return [
            {
                domain: args.domain,
                selector: 'input + newChat',
                failureType: 'wrong_page',
                slots: failed.map((s) => s.slot),
                message: 'health check: neither critical slot exists in the DOM (' +
                    args.providerId +
                    ') — wrong page or the app did not render. tried: ' +
                    failed
                        .map((s) => s.slot + ' [' + s.candidates.join(', ') + ']')
                        .join('; '),
                url: args.url
            }
        ];
    }
    return failed.map((s) => ({
        domain: args.domain,
        selector: s.candidates[0] ?? '',
        failureType: (s.present ? 'hidden' : 'not_found'),
        slot: s.slot,
        message: 'health check: no working selector for ' +
            args.providerId +
            '.' +
            s.slot +
            ' (tried: ' +
            s.candidates.join(', ') +
            ')' +
            (s.healed ? '; local heal proposed: ' + s.healed : '; local heal found nothing'),
        url: args.url
    }));
}
//# sourceMappingURL=selectorHealth.js.map