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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const browser_1 = require("./browser");
const chatView_1 = require("./chatView");
const selectors_1 = require("./selectors");
const log_1 = require("./log");
const diagnostics_1 = require("./diagnostics");
const remoteSelectors_1 = require("./remoteSelectors");
const ai_selector_finder_1 = require("./ai-selector-finder");
const browserAi_1 = require("./browserAi");
const manager_1 = require("./mcp/manager");
const stt_1 = require("./stt");
const devServers_1 = require("./devServers");
const indexer_1 = require("./indexer");
const ollama_1 = require("./providers/ollama");
const providers_1 = require("./providers");
const reporting_1 = require("./reporting");
const trust_1 = require("./trust");
/** v0.3.0 (P0.1): opțiunile browserului, citite live din setări. */
function browserOptionsFromConfig(ctx) {
    const cfg = vscode.workspace.getConfiguration('freekit');
    const rawPort = Number(cfg.get('cdpPort', 9222));
    const port = Number.isFinite(rawPort) && rawPort >= 1024 && rawPort <= 65535
        ? Math.floor(rawPort)
        : 9222;
    const chromePath = String(cfg.get('chromePath', '') || '').trim();
    return {
        port,
        // P0.1: profilul stă în globalStorage (NU în folderul proiectului)
        profileDir: path.join(ctx.globalStorageUri.fsPath, 'chrome-profile'),
        chromePath: chromePath || undefined
    };
}
/**
 * v2.0.0 (rebranding AI Bridge -> Freekit): cheile din globalState au trecut
 * de la prefixul `aiBridge.` la `freekit.`. Copiem o singură dată valorile
 * existente, ca istoricul conversațiilor, checkpoint-urile și preferințele
 * să nu se piardă la upgrade. Cheile vechi NU sunt șterse (rollback sigur).
 */
async function migrateLegacyBrandState(state) {
    const NEW_PREFIX = 'freekit.';
    const LEGACY_PREFIX = 'ai' + 'Bridge.';
    const keys = [
        'history',
        'autoApprove',
        'lastBrowserProvider',
        'noAskFiles',
        'verboseMode',
        'checkpoints',
        'conversations',
        'activeConversationId',
        'selectorsAutoCheck',
        'selectorOverrides',
        'remoteSelectors'
    ];
    for (const key of keys) {
        try {
            const legacy = state.get(LEGACY_PREFIX + key);
            if (legacy !== undefined && state.get(NEW_PREFIX + key) === undefined) {
                await state.update(NEW_PREFIX + key, legacy);
            }
        }
        catch {
            // fail-open: migrarea nu trebuie să blocheze activarea extensiei
        }
    }
}
async function activate(ctx) {
    (0, log_1.initLogChannel)();
    (0, log_1.logLine)('extension', 'activated — container: freekit, view: freekit.chatView');
    // v2.4.1 — Restricted Mode (fără Workspace Trust): extensia se activează
    // LIMITAT (doar citire) și îi spune explicit utilizatorului ce are de făcut.
    if ((0, trust_1.isRestricted)()) {
        (0, log_1.logLine)('trust', 'Restricted Mode: read-only features only until the folder is trusted');
    }
    // v2.4.1: „Trust This Workspace” — comanda din Command Palette + butonul din notificare
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.trustWorkspace', () => (0, trust_1.promptForTrust)()));
    // v2.0.0: migrează starea din globalState de dinainte de rebranding
    await migrateLegacyBrandState(ctx.globalState);
    // v1.10.0: indexarea semantică (vector store JSON în globalStorage)
    (0, indexer_1.initIndexer)(ctx.globalStorageUri.fsPath);
    const browser = new browser_1.BrowserManager(() => browserOptionsFromConfig(ctx));
    // FAZA I: cache-ul de selectori (override-urile reparate în globalState)
    selectors_1.selectors.init(ctx.globalState);
    // v0.9.5: AI selector discovery (fallback pe Ollama) + selectors-user.json
    // v2.5.65 (FIX 5): versiunea extensiei e folosită pentru migrația de selectori
    // (curățenia automată a selectorilor auto invalizi la fiecare update).
    (0, ai_selector_finder_1.initAISelectorFinder)(ctx.globalStorageUri.fsPath, ctx.extension.packageJSON.version);
    // v2.5.61 (FIX 2): modul `browser` al AI Finder-ului are nevoie de un TAB NOU
    // în Chrome (chat-ul aflat în lucru nu se atinge); fereastra rămâne în fundal.
    (0, browserAi_1.setBrowserAiPageFactory)(() => browser.newPage());
    const cfg = (0, selectors_1.configInfo)();
    (0, log_1.logLine)('extension', 'selectors v' +
        cfg.version +
        ' (' +
        cfg.updated +
        ', source: ' +
        cfg.source +
        (cfg.remoteUrl ? ' — ' + cfg.remoteUrl : '') +
        ') — providers: ' +
        cfg.providers.join(', ') +
        ' — saved overrides: ' +
        selectors_1.selectors.listLearned().length);
    // v0.7.0: verificare automată a selectorilor remote la pornire (opțional)
    // v0.7.1: rate limiting 24h — cel mult o verificare automată pe zi
    // (comanda manuală „Freekit: Update Selectors” ocolește limita).
    const selUrl = (0, selectors_1.selectorsUrlFromSettings)();
    if (selUrl &&
        vscode.workspace.getConfiguration('freekit').get('checkSelectorsOnStartup', true)) {
        if ((0, remoteSelectors_1.shouldAutoCheck)(ctx.globalState, selUrl)) {
            void (0, remoteSelectors_1.checkAndApplyRemote)(selUrl, ctx.globalState).then((r) => {
                if (r.status === 'updated') {
                    vscode.window.showInformationMessage('Freekit: the selectors were updated automatically to v' +
                        r.version +
                        '.' +
                        (r.changelog ? ' ' + r.changelog : ''));
                }
            });
        }
        else {
            (0, log_1.logLine)('extension', 'selectors: automatic check skipped (last check < 24h ago) — use “Freekit: Update Selectors” for a manual one');
        }
    }
    const chatView = new chatView_1.ChatViewProvider(ctx.extensionUri, browser, ctx.globalState, 
    // v1.7.2: asset-urile Whisper (voice input offline) stau în globalStorage
    ctx.globalStorageUri.fsPath);
    ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(chatView_1.ChatViewProvider.viewType, chatView));
    // v2.4.0 — integrare self-maintaining cu serverul de raportare:
    // register la prima pornire, health check periodic (selectorii stricați
    // sunt reparați local sau raportați) și fetch periodic de selectori.
    const reporting = new reporting_1.ReportingService(ctx, {
        browser,
        notify: (text) => chatView.postNotice(text)
    });
    ctx.subscriptions.push(reporting);
    // v2.4.1: serviciile care scriu în globalState, vorbesc cu serverul de
    // raportare sau pornesc procese MCP nu pornesc în Restricted Mode; ele sunt
    // activate automat în momentul în care Trust-ul e acordat.
    const startTrustedFeatures = () => {
        reporting.start();
        void manager_1.mcp.init(ctx, (text) => chatView.postNotice(text));
    };
    // v2.4.0: starea integrării + acțiuni de control
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.reportingStatus', async () => {
        const text = 'Freekit reporting — ' + reporting.client.statusText();
        (0, log_1.logLine)('reporting', 'status: ' + reporting.client.statusText());
        const pick = await vscode.window.showInformationMessage(text, 'Run health check now', 'Reset registration');
        if (pick === 'Run health check now') {
            await vscode.commands.executeCommand('freekit.reportingCheckNow');
        }
        else if (pick === 'Reset registration') {
            await vscode.commands.executeCommand('freekit.reportingReset');
        }
    }));
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.reportingCheckNow', async () => {
        // v2.4.1: verificarea deschide tab-uri și trimite rapoarte — doar cu Trust
        if ((0, trust_1.isRestricted)()) {
            (0, trust_1.showRestrictedNotification)(true);
            return;
        }
        const client = reporting.client;
        if (!client.enabled) {
            vscode.window.showWarningMessage('Freekit: reporting is disabled (freekit.reporting.enabled).');
            return;
        }
        const key = await client.ensureRegistered();
        if (!key) {
            vscode.window.showWarningMessage('Freekit: could not reach the reporting server (' +
                client.endpoint +
                '). Check your connection or the freekit.reporting.endpoint setting.');
            return;
        }
        const out = await reporting.runHealthCheck(true);
        if (!out.checkedProviders.length) {
            vscode.window.showInformationMessage('Freekit: no web AI chat tab is open, so there was nothing to check — open a provider in Chrome first.');
            return;
        }
        vscode.window.showInformationMessage('Freekit: health check done — ' +
            out.checkedProviders.join(', ') +
            '. ' +
            (out.failures.length
                ? out.failures.length + ' selector failure(s) were reported to the server.'
                : 'All selectors are healthy.'));
    }));
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.reportingReset', async () => {
        const pick = await vscode.window.showWarningMessage('Freekit: remove the local reporting identity? The extension will register again as a new installation on the next start.', { modal: true }, 'Reset');
        if (pick !== 'Reset')
            return;
        await reporting.client.resetIdentity();
        vscode.window.showInformationMessage('Freekit: reporting identity reset.');
    }));
    // v1.6.0: limba voice input (butonul 🎤 din chat)
    // v1.7.3: limba e citită de extensie la momentul transcrierii — nu mai
    // trebuie trimisă webview-ului la schimbarea setării (captarea rulează în host)
    // v1.7.2: setup Whisper local — descarcă binarele whisper.cpp + modelul
    // ggml-base în globalStorage (o singură dată), pentru voice input offline
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.setupWhisper', async () => {
        const gs = ctx.globalStorageUri.fsPath;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Freekit: local Whisper setup (offline STT)',
            cancellable: false
        }, async (prog) => {
            const res = await (0, stt_1.setupWhisperAssets)(gs, (pct, label) => prog.report({
                message: label + (pct >= 0 ? ' — ' + pct + '%' : '…')
            }));
            if (res.ok) {
                const msg = 'Local Whisper is ready ✓ — ' +
                    path.basename(res.cliPath ?? '') +
                    ' + ' +
                    path.basename(res.modelPath ?? '');
                vscode.window.showInformationMessage('Freekit: ' + msg);
                chatView.postNotice('🎤 ' + msg);
            }
            else {
                vscode.window.showErrorMessage('Freekit: local Whisper setup failed — ' + (res.error ?? 'unknown error'));
                chatView.postNotice('🎤 ⚠️ Local Whisper setup failed: ' + (res.error ?? 'unknown error'));
            }
        });
    }));
    // v2.0.2: „Install Ollama" — butonul care duce la pagina oficială de download.
    // Dacă Ollama e deja prezent, nu mai deschidem pagina: spunem ce lipsește
    // (serverul pornit cu „ollama serve").
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.installOllama', async () => {
        const state = (0, providers_1.ollamaInstallState)(await (0, providers_1.getProviderStatus)());
        if (state === 'running') {
            vscode.window.showInformationMessage('Freekit: Ollama is already running at ' + (0, ollama_1.ollamaBaseUrl)() + '.');
            return;
        }
        if (state === 'installed') {
            vscode.window.showInformationMessage('Freekit: Ollama is installed but not running — start the server with "ollama serve".');
            return;
        }
        await vscode.env.openExternal(vscode.Uri.parse(ollama_1.OLLAMA_DOWNLOAD_URL));
        vscode.window.showInformationMessage('Freekit: install Ollama from the page that just opened, then run "ollama serve".');
        chatView.postNotice('🦙 Ollama is not installed — the download page was opened. After installing it, run "ollama serve".');
    }));
    // v2.5.11 (bug #21): „Open Browser" și „Show Chrome" făceau lucruri aproape
    // identice (ambele porneau Chrome, dar „Open Browser" îl lăsa ascuns), ceea ce
    // crea confuzie. Comanda rămâne înregistrată ca alias ascuns pentru
    // back-compat (nu mai e listată în Command Palette), dar face exact ce face
    // „Show Browser": pornește Chrome dacă e nevoie ȘI îl aduce pe ecran.
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.openBrowser', () => chatView.showChrome()));
    // v0.3.0 (P0.3): Close Browser chiar închide procesul
    // (CDP Browser.close, cu fallback kill pe PID-ul care ascultă pe port)
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.closeBrowser', async () => {
        const closed = await browser.close();
        if (closed) {
            vscode.window.showInformationMessage('Chrome closed.');
        }
        else {
            vscode.window.showWarningMessage('I could not close Chrome — please close it manually from Task Manager.');
        }
    }));
    // FAZA I: uită selectorii învățați (revin la cei din selectors.json)
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.resetSelectors', async () => {
        const removed = selectors_1.selectors.reset();
        // v2.5.44 (bug #101): selecțiile scrise manual (user-locked) se păstrează
        const kept = selectors_1.selectors.lockedCount();
        if (removed === 0 && kept === 0) {
            vscode.window.showInformationMessage('Freekit: no saved repaired selectors were found.');
        }
        else {
            vscode.window.showInformationMessage('Freekit: removed ' +
                removed +
                ' saved repaired selectors. The configured selectors are being used again' +
                ' (bundled or remote, if enabled).' +
                (kept
                    ? ' Kept ' +
                        kept +
                        ' manual (user-locked) selector(s) — edit selectors-user.json to change them.'
                    : ''));
        }
    }));
    // v0.7.0: update manual al selectorilor din Gist-ul configurat
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.updateSelectors', async () => {
        const url = (0, selectors_1.selectorsUrlFromSettings)();
        if (!url) {
            vscode.window.showWarningMessage('Freekit: set the "freekit.selectorsUrl" value first (the raw Gist URL for selectors.json).');
            return;
        }
        // v0.7.1: și verificarea manuală resetează ceasul de 24h
        const r = await (0, remoteSelectors_1.checkAndApplyRemote)(url, ctx.globalState);
        if (r.status === 'updated') {
            const from = r.previousVersion ? ' (v' + r.previousVersion + ' → v' + r.version + ')' : '';
            vscode.window.showInformationMessage('Freekit: the selectors were updated' +
                from +
                '.' +
                (r.changelog ? ' ' + r.changelog : ''));
        }
        else if (r.status === 'up-to-date') {
            vscode.window.showInformationMessage('Freekit: the selectors are already up to date (v' + (r.activeVersion ?? '?') + ').');
        }
        else {
            vscode.window.showErrorMessage('Freekit: updating the selectors failed — ' + (r.message ?? 'unknown error'));
        }
    }));
    // Repair Selectors is manual and bypasses the automatic-discovery setting.
    // Pornește de la tab-ul deschis în Chrome:
    // providerul e dedus din URL (nu există o „selecție activă" în extensie).
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.rediscoverSelectors', async (statusId) => {
        if ((0, trust_1.isRestricted)()) {
            (0, trust_1.showRestrictedNotification)(true);
            return;
        }
        const page = await browser.ensureOpen().catch((e) => {
            vscode.window.showErrorMessage('Freekit: could not open the browser — ' + (e?.message ?? String(e)));
            return null;
        });
        if (!page)
            return;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Freekit: repairing selectors for the provider open in Chrome…'
        }, async () => {
            const { providerId, outcome } = await (0, ai_selector_finder_1.rediscoverSelectors)(page, statusId);
            if (!providerId) {
                vscode.window.showWarningMessage('Freekit: no provider chat is open in the Chrome window — open one ' +
                    '(DeepSeek, ChatGPT, Gemini, Claude, Mistral, Qwen) and run the command again.');
                return;
            }
            const label = providers_1.PROVIDER_LABELS[providerId] || providerId;
            if (outcome?.applied.length) {
                vscode.window.showInformationMessage('Freekit: ' + label + ' → ' + outcome.applied.join(', ') + ' (saved as auto).');
            }
            else {
                vscode.window.showWarningMessage('Freekit: no usable selector was found for ' +
                    label +
                    ' (' +
                    (outcome?.reason ?? 'discovery did not run') +
                    '). Check the “Freekit” output for details.');
            }
        });
    }));
    /* ---------------------------------------------------------------------
     * v2.5.72 (FIX 3/6) — SELECTORI USER-LOCKED STRICAȚI
     *
     * Un selector scris manual care nu mai găsește elementul e testat funcțional
     * și, dacă pică, iese din `_meta.locked` (apoi AI Finder-ul îl repară și îl
     * re-lockuiește). Comenzile de mai jos fac același lucru LA CERERE, pentru
     * toți providerii sau doar pentru unul.
     * ------------------------------------------------------------------- */
    const PROVIDER_CHOICES = ai_selector_finder_1.USER_LOCK_PROVIDERS.map((id) => ({
        label: providers_1.PROVIDER_LABELS[id] || id,
        id
    }));
    const unlockForProvider = async (provider) => {
        if ((0, trust_1.isRestricted)()) {
            (0, trust_1.showRestrictedNotification)(true);
            return;
        }
        const label = provider ? providers_1.PROVIDER_LABELS[provider] || provider : 'all providers';
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Freekit: unlocking broken selectors (' + label + ')…'
        }, async () => {
            const getPage = async (pid) => {
                try {
                    return await browser.pageForHost(selectors_1.selectors.host(pid));
                }
                catch {
                    return null;
                }
            };
            const outcome = await (0, ai_selector_finder_1.unlockBrokenUserSelectors)(getPage, { provider });
            if (!outcome.tested) {
                vscode.window.showInformationMessage('Freekit: no user-locked selector to test' +
                    (provider ? ' for ' + label : '') +
                    ' — open the provider chat in Chrome first.');
                return;
            }
            if (!outcome.unlocked) {
                vscode.window.showInformationMessage('Freekit: tested ' + outcome.tested + ' user-locked selector(s) — all still work.');
                return;
            }
            vscode.window.showInformationMessage('Freekit: unlocked ' +
                outcome.unlocked +
                ' broken selector(s)' +
                (outcome.repaired ? ' — ' + outcome.repaired + ' auto-repaired' : '') +
                '.');
        });
    };
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.unlockBrokenSelectors', () => unlockForProvider()));
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.unlockBrokenSelectorsProvider', async () => {
        const pick = await vscode.window.showQuickPick(PROVIDER_CHOICES.map((c) => ({ label: c.label, id: c.id })), {
            title: 'Freekit: Unlock broken selectors — provider',
            placeHolder: 'Choose a provider'
        });
        if (!pick)
            return;
        await unlockForProvider(pick.id);
    }));
    for (const choice of PROVIDER_CHOICES) {
        const suffix = choice.id.charAt(0).toUpperCase() + choice.id.slice(1);
        ctx.subscriptions.push(vscode.commands.registerCommand('freekit.unlockBrokenSelectors' + suffix, () => unlockForProvider(choice.id)));
    }
    const resetFailures = async (provider) => {
        const removed = (0, ai_selector_finder_1.resetUserLockFailures)(provider);
        vscode.window.showInformationMessage('Freekit: selector failure counters reset' +
            (provider ? ' for ' + (providers_1.PROVIDER_LABELS[provider] || provider) : ' (all providers)') +
            (removed ? ' — ' + removed + ' counter(s) cleared' : '') +
            '.');
    };
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.resetSelectorFailures', () => resetFailures()));
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.resetSelectorFailuresProvider', async () => {
        const pick = await vscode.window.showQuickPick(PROVIDER_CHOICES.map((c) => ({ label: c.label, id: c.id })), {
            title: 'Freekit: Reset selector failure counters — provider',
            placeHolder: 'Choose a provider'
        });
        if (!pick)
            return;
        await resetFailures(pick.id);
    }));
    // v0.3.0 (P0.5): comanda Diagnostics
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.diagnostics', () => (0, diagnostics_1.runDiagnostics)(browser, ctx)));
    // v0.4.0: Show Browser — aduce fereastra offscreen (-32000,-32000) în față
    // v2.5.11 (bug #21): singurul buton vizibil pentru aducerea browserului pe ecran
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.showChrome', () => chatView.showChrome()));
    // v0.4.0: raport detaliat al providerilor (browser CDP / DeepSeek / Ollama)
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.showProviderStatus', () => chatView.showProviderStatusReport()));
    // v0.5.0: golește lista „nu mai întreba" pentru aprobările de fișiere
    // (fișierele aprobate cu „Accept (nu mai întreba)" în diff-ul nativ)
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.clearNoAsk', () => chatView.clearNoAskFiles()));
    // v1.8.1: oprește toate serverele de dezvoltare pornite de AI într-un
    // terminal VS Code (scripturi/comenzi dev, start, serve, watch, preview —
    // ex. „npm run dev”): Ctrl+C grațios, apoi închiderea terminalului
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.stopDevServers', async () => {
        const report = await (0, devServers_1.stopDevServers)();
        const total = report.stopped.length + report.failed.length;
        if (!total) {
            vscode.window.showInformationMessage('Freekit: no development server started by Freekit is currently running.');
            return;
        }
        if (report.failed.length) {
            vscode.window.showWarningMessage('Freekit: ' +
                report.stopped.length +
                ' development server(s) stopped, ' +
                report.failed.length +
                ' could not be stopped (' +
                report.failed
                    .map((f) => f.terminalName || 'PID ' + f.pid)
                    .join(', ') +
                ').');
        }
        else {
            vscode.window.showInformationMessage('Freekit: ' +
                report.stopped.length +
                ' development server(s) stopped: ' +
                report.stopped
                    .map((s) => s.command + ' (terminal “' + s.terminalName + '”)')
                    .join('; '));
        }
        (0, log_1.logLine)('devServers', 'Stop Dev Servers: ' +
            report.stopped.length +
            ' stopped' +
            (report.stopped.length
                ? ' (' +
                    report.stopped
                        .map((s) => s.terminalName + ': ' + s.command)
                        .join(', ') +
                    ')'
                : '') +
            (report.failed.length ? ' — ' + report.failed.length + ' failed' : ''));
    }));
    /* =======================================================================
     * v1.10.0 — INDEXARE SEMANTICĂ (embeddings Ollama + vector store local)
     * Trei comenzi: Index Workspace / Index Status / Clear Index. Indexarea
     * rulează cu progres anulabil în bara de notificări; căutarea semantică e
     * expusă AI-ului prin unealta `search_semantic`.
     * ===================================================================== */
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.indexWorkspace', async () => {
        const root = (0, indexer_1.workspaceRoot)();
        if (!root) {
            vscode.window.showWarningMessage('Freekit: open a folder (workspace) before indexing.');
            return;
        }
        const cfg = (0, indexer_1.semanticConfig)();
        if (!(await (0, indexer_1.isOllamaUp)())) {
            const msg = 'Ollama is not reachable at ' + (0, ollama_1.ollamaBaseUrl)() + '. Start it with "ollama serve".';
            vscode.window.showErrorMessage('Freekit: ' + msg);
            chatView.postNotice('🔎 ⚠️ Semantic index: ' + msg);
            return;
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Freekit: indexing workspace with ' + cfg.model,
            cancellable: true
        }, async (prog, token) => {
            const ac = new AbortController();
            const sub = token.onCancellationRequested(() => ac.abort());
            try {
                const stats = await (0, indexer_1.indexWorkspace)(root, {
                    signal: ac.signal,
                    onProgress: (p) => prog.report({ message: p.done + '/' + p.total + ' — ' + p.file })
                });
                const summary = stats.indexed +
                    ' files indexed, ' +
                    stats.unchanged +
                    ' unchanged, ' +
                    stats.removed +
                    ' removed, ' +
                    stats.chunks +
                    ' chunks' +
                    (stats.skipped ? ', ' + stats.skipped + ' skipped' : '') +
                    (stats.failed ? ', ' + stats.failed + ' chunks failed' : '') +
                    (stats.cancelled ? ' — cancelled' : '') +
                    ' (' +
                    Math.round(stats.durationMs / 1000) +
                    's)';
                if (stats.cancelled) {
                    vscode.window.showWarningMessage('Freekit: indexing cancelled — ' + summary);
                }
                else {
                    vscode.window.showInformationMessage('Freekit: semantic index ready — ' + summary);
                }
                chatView.postNotice('🔎 Semantic index: ' + summary);
            }
            catch (e) {
                const msg = e?.message ?? String(e);
                (0, log_1.logLine)('indexer', 'index workspace failed: ' + msg);
                vscode.window.showErrorMessage('Freekit: indexing failed — ' + msg);
                chatView.postNotice('🔎 ⚠️ Indexing failed: ' + msg);
            }
            finally {
                sub.dispose();
            }
        });
    }));
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.indexStatus', async () => {
        const root = (0, indexer_1.workspaceRoot)();
        if (!root) {
            vscode.window.showWarningMessage('Freekit: open a folder (workspace) to see the index status.');
            return;
        }
        const text = await (0, indexer_1.indexStatusText)(root);
        (0, log_1.logLine)('indexer', text.replace(/\n/g, ' | '));
        vscode.window.showInformationMessage('Freekit: ' + text.split('\n').slice(0, 4).join(' · '));
        chatView.postNotice('🔎 ' + text.split('\n').join('\n'));
    }));
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.clearIndex', async () => {
        const root = (0, indexer_1.workspaceRoot)();
        if (!root) {
            vscode.window.showWarningMessage('Freekit: open a folder (workspace) first.');
            return;
        }
        const answer = await vscode.window.showWarningMessage('Freekit: delete the semantic index for "' +
            path.basename(root) +
            '"? The vector store is removed from globalStorage; you can rebuild it anytime with "Index Workspace".', { modal: true }, 'Delete Index');
        if (answer !== 'Delete Index')
            return;
        const removed = await (0, indexer_1.clearIndex)(root);
        if (removed) {
            vscode.window.showInformationMessage('Freekit: semantic index deleted.');
            chatView.postNotice('🔎 Semantic index deleted.');
        }
        else {
            vscode.window.showInformationMessage('Freekit: there was no semantic index to delete.');
        }
    }));
    // v1.10.0: indexare incrementală la salvare (opțional, freekit.semanticIndex.onSave)
    let saveTimer;
    const pendingSaves = new Set();
    ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.scheme !== 'file')
            return;
        if (!(0, indexer_1.isSemanticEnabled)() || !(0, indexer_1.semanticConfig)().onSave)
            return;
        const root = (0, indexer_1.workspaceRoot)();
        if (!root)
            return;
        const abs = doc.uri.fsPath;
        if (!abs.startsWith(root))
            return;
        pendingSaves.add(abs);
        if (saveTimer)
            clearTimeout(saveTimer);
        // debounce: mai multe salvări rapide => o singură trecere
        saveTimer = setTimeout(() => {
            const files = Array.from(pendingSaves);
            pendingSaves.clear();
            void (async () => {
                for (const f of files) {
                    try {
                        await (0, indexer_1.indexSingleFile)(root, f);
                    }
                    catch (e) {
                        (0, log_1.logLine)('indexer', 'on-save indexing failed: ' + (e?.message ?? String(e)));
                    }
                }
            })();
        }, 1500);
    }));
    // v1.1.0 — MCP (Model Context Protocol): pornește serverele configurate în
    // .vscode/mcp.json sau în freekit.mcpServers, descoperă uneltele lor și le
    // expune AI-ului ca „mcp_<server>_<tool>”. Reîncărcare automată la
    // modificarea configului; UI de gestionare în comanda dedicată.
    ctx.subscriptions.push(vscode.commands.registerCommand('freekit.mcpManage', () => {
        // v2.4.1: MCP pornește procese externe — doar cu Workspace Trust
        if ((0, trust_1.isRestricted)()) {
            (0, trust_1.showRestrictedNotification)(true);
            return;
        }
        return manager_1.mcp.showManagerUi();
    }));
    // v2.4.1: activarea completă (reporting + MCP) cere Workspace Trust. În
    // Restricted Mode rămân doar funcțiile de citire, iar utilizatorul primește
    // notificarea-imposibil-de-ratat cu butonul „Trust Workspace”.
    if ((0, trust_1.isRestricted)()) {
        (0, trust_1.showRestrictedNotification)();
        (0, log_1.logLine)('trust', 'deferred features until trust: reporting, MCP');
    }
    else {
        startTrustedFeatures();
    }
    // Trust acordat fără reload (ex. din dialogul nativ): pornim serviciile
    // amânate și confirmăm în chat că modul complet e activ.
    ctx.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => {
        if ((0, trust_1.isRestricted)())
            return;
        (0, log_1.logLine)('trust', 'workspace trust granted — enabling reporting + MCP');
        startTrustedFeatures();
        chatView.postNotice('✅ Workspace trusted — Freekit full mode enabled (file writes, commands and MCP tools unlocked).');
    }));
    // v1.8.1: serverele de dezvoltare pornite în terminale VS Code (run_npm /
    // run_command cu scripturi dev/serve/watch) sunt oprite best-effort la
    // închiderea ferestrei — altfel ar rămâne procese orfane pe care comanda
    // Stop Dev Servers nu le mai poate găsi (registrul e în memorie).
    ctx.subscriptions.push({ dispose: () => void (0, devServers_1.stopDevServers)() });
    // la dezactivare doar deconectăm — NU omorâm Chrome (poate fi folosit în continuare)
    ctx.subscriptions.push({ dispose: () => browser.disconnect() });
}
function deactivate() { }
//# sourceMappingURL=extension.js.map