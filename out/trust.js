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
exports.RESTRICTED_TOOL_ERROR = exports.RESTRICTED_BLOCKED_NOTICE = exports.RESTRICTED_NOTICE = void 0;
exports.isRestricted = isRestricted;
exports.showRestrictedNotification = showRestrictedNotification;
exports.promptForTrust = promptForTrust;
const vscode = __importStar(require("vscode"));
const log_1 = require("./log");
/**
 * v2.4.1 — Trust UX.
 *
 * The extension declares `untrustedWorkspaces: limited`, so it ACTIVATES in
 * Restricted Mode instead of staying silent: read-only features keep working
 * and the user gets an unmissable notification with a "Trust Workspace" button.
 * Everything user-facing about Workspace Trust lives here, so the wording is
 * identical in the notification, in the chat card and in the tool errors.
 */
const TRUST_DOC_URL = 'https://code.visualstudio.com/docs/editor/workspace-trust';
/** Anti-spam: o acțiune blocată re-afișează notificarea cel mult o dată la 20 s. */
const RESHOW_COOLDOWN_MS = 20_000;
/** True când fereastra curentă NU are Workspace Trust acordat. */
function isRestricted() {
    return !vscode.workspace.isTrusted;
}
/** Cardul persistent din chat (apare la deschiderea view-ului în Restricted Mode). */
exports.RESTRICTED_NOTICE = 'Restricted Mode: Freekit can read files, but writing files, running commands, ' +
    'git changes, MCP tools and the selector health check are disabled until this folder is trusted. ' +
    'Run “Freekit: Trust This Workspace” (or click “Trust Workspace” in the notification) to unlock everything.';
/** Linia scurtă din chat când o acțiune concretă e blocată. */
exports.RESTRICTED_BLOCKED_NOTICE = 'Restricted Mode — the action was blocked. Trust this folder (Command Palette → ' +
    '“Freekit: Trust This Workspace”) to unlock it.';
/** Eroarea trimisă modelului când o unealtă e blocată de Restricted Mode. */
exports.RESTRICTED_TOOL_ERROR = 'Restricted Mode: Freekit cannot write files, run commands, change git state or use MCP tools ' +
    'in an untrusted workspace. Ask the user to trust this folder — Command Palette → ' +
    '"Freekit: Trust This Workspace" (or the Trust Workspace button in the VS Code notification) — ' +
    'then retry. Read-only tools (read_file, list_files, search_files, read_files, project_info, ' +
    'search_semantic, git status/diff/log) still work.';
let shownThisSession = false;
let lastShownAt = 0;
/**
 * Notificarea de activare (imposibil de ratat). Se afișează o singură dată pe
 * sesiune; `force` o re-afișează când utilizatorul chiar încearcă o acțiune
 * blocată, cu limită de timp ca să nu devină spam.
 */
function showRestrictedNotification(force = false) {
    if (!isRestricted())
        return;
    const now = Date.now();
    if (force) {
        if (now - lastShownAt < RESHOW_COOLDOWN_MS)
            return;
    }
    else if (shownThisSession) {
        return;
    }
    shownThisSession = true;
    lastShownAt = now;
    (0, log_1.logLine)('trust', 'Restricted Mode — showing the Workspace Trust notification');
    void vscode.window
        .showWarningMessage('Freekit is running in Restricted Mode. It can read files, but writing files, running ' +
        'commands, git changes and MCP tools are disabled until this folder is trusted.', 'Trust Workspace', 'Learn More')
        .then((pick) => {
        if (pick === 'Trust Workspace')
            void promptForTrust();
        else if (pick === 'Learn More')
            void vscode.env.openExternal(vscode.Uri.parse(TRUST_DOC_URL));
    });
}
/**
 * Trimite utilizatorul în fluxul nativ de Workspace Trust.
 *
 * `workspace.requestWorkspaceTrust` e încă un API *proposed*, deci folosim
 * comanda stabilă `workbench.trust.manage`: deschide pagina „Manage Workspace
 * Trust”, unde folderul are butonul „Trust” (un click → trust + reload).
 */
async function promptForTrust() {
    if (!isRestricted()) {
        vscode.window.showInformationMessage('Freekit: this workspace is already trusted.');
        return;
    }
    try {
        await vscode.commands.executeCommand('workbench.trust.manage');
    }
    catch (e) {
        (0, log_1.logLine)('trust', 'workbench.trust.manage failed: ' + (e?.message ?? String(e)));
        await vscode.env.openExternal(vscode.Uri.parse(TRUST_DOC_URL));
    }
}
//# sourceMappingURL=trust.js.map