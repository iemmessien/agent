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
exports.TS6059_TSCONFIG_JSON = exports.VERIFY_TIMEOUT_MS = void 0;
exports.detectVerificationCommand = detectVerificationCommand;
exports.verifyCommandString = verifyCommandString;
exports.runVerification = runVerification;
exports.commandErrorFiles = commandErrorFiles;
exports.looksLikeTsconfigError = looksLikeTsconfigError;
exports.buildCommandErrorHints = buildCommandErrorHints;
exports.looksLikeTs6059 = looksLikeTs6059;
exports.ts6059TsconfigRel = ts6059TsconfigRel;
exports.buildTs6059Hint = buildTs6059Hint;
exports.buildTsconfigRewriteInjection = buildTsconfigRewriteInjection;
exports.buildTs6059FirstFailureInjection = buildTs6059FirstFailureInjection;
exports.buildScopedTsconfigNudge = buildScopedTsconfigNudge;
exports.ensureGitRepo = ensureGitRepo;
exports.createPromptCheckpoint = createPromptCheckpoint;
exports.restoreToCheckpoint = restoreToCheckpoint;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const log_1 = require("./log");
const payload_1 = require("./payload");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
const log = (msg) => (0, log_1.logLine)('verify', msg);
exports.VERIFY_TIMEOUT_MS = 120000;
const VERIFY_OUTPUT_MAX = 10000;
/**
 * Alege comanda de verificare potrivită pentru proiect:
 *  - Astro (cu @astrojs/check instalat) → `astro check`
 *  - Next / Vite / orice proiect cu tsconfig + TypeScript → `tsc --noEmit`
 *  - altfel scriptul `typecheck` / `build` / `lint` din package.json
 * Întoarce null dacă nu există package.json sau nicio verificare posibilă.
 */
async function detectVerificationCommand(root) {
    const pkgPath = path.join(root, 'package.json');
    if (!fs.existsSync(pkgPath))
        return null;
    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    }
    catch {
        log('package.json invalid — verificarea nu poate fi detectată');
        return null;
    }
    const scripts = (pkg && typeof pkg.scripts === 'object' && pkg.scripts) || {};
    const deps = {
        ...(pkg?.dependencies ?? {}),
        ...(pkg?.devDependencies ?? {})
    };
    // package manager din lockfile
    let pm = 'npm';
    if (fs.existsSync(path.join(root, 'pnpm-lock.yaml')))
        pm = 'pnpm';
    else if (fs.existsSync(path.join(root, 'yarn.lock')))
        pm = 'yarn';
    const hasTsconfig = fs.existsSync(path.join(root, 'tsconfig.json'));
    const haveTsc = !!deps.typescript ||
        fs.existsSync(path.join(root, 'node_modules', 'typescript'));
    let type = 'node';
    let checkScript = '';
    // 1) Astro — `astro check` e cel mai rapid, dar are nevoie de @astrojs/check
    if (deps.astro) {
        type = 'astro';
        if (deps['@astrojs/check'])
            checkScript = 'astro check';
    }
    // 2) Next / Vite — type-check rapid cu tsc (când TypeScript există)
    if (!checkScript && deps.next) {
        type = 'next';
        if (hasTsconfig && haveTsc)
            checkScript = 'tsc --noEmit';
    }
    if (!checkScript &&
        (deps.vite || deps['@vitejs/plugin-react'])) {
        type = 'vite';
        if (hasTsconfig && haveTsc)
            checkScript = 'tsc --noEmit';
    }
    // 3) tsconfig + TypeScript instalat → tsc --noEmit (rapid, fiabil)
    if (!checkScript && hasTsconfig && haveTsc) {
        checkScript = 'tsc --noEmit';
    }
    // 4) altfel scripturile proiectului (typecheck → build → lint)
    if (!checkScript && typeof scripts.typecheck === 'string') {
        checkScript = 'typecheck';
    }
    if (!checkScript && typeof scripts.build === 'string') {
        checkScript = 'build';
    }
    if (!checkScript && typeof scripts.lint === 'string') {
        checkScript = 'lint';
    }
    if (!checkScript)
        return null;
    return { type, packageManager: pm, checkScript };
}
/** Construiește linia de comandă pentru verificarea detectată. */
function verifyCommandString(project) {
    const pm = project.packageManager;
    const runBin = (bin, rest) => {
        if (pm === 'yarn')
            return 'yarn ' + bin + rest; // yarn rezolvă binarele locale
        if (pm === 'pnpm')
            return 'pnpm exec ' + bin + rest;
        return 'npx ' + bin + rest;
    };
    if (project.checkScript === 'tsc --noEmit')
        return runBin('tsc', ' --noEmit');
    if (project.checkScript === 'astro check')
        return runBin('astro', ' check');
    return pm + ' run ' + project.checkScript;
}
/**
 * v2.5.31 (bug #72): binarul local `tsc` (din folderul dat sau din root) —
 * rulat cu `node`, ca `npx tsc` pornit din subfolder să nu instaleze pachetul
 * greșit și să folosească compilatorul proiectului.
 */
function resolveTscBin(fromDir, root) {
    for (const base of [fromDir, root]) {
        const bin = path.join(base, 'node_modules', 'typescript', 'bin', 'tsc');
        try {
            if (fs.existsSync(bin))
                return bin;
        }
        catch {
            /* ignoră */
        }
    }
    return null;
}
/**
 * Rulează verificarea proiectului. Întoarce mereu un VerifyResult —
 * `command` gol înseamnă „nicio verificare configurată” (ok: true, no-op).
 * v2.5.31 (bug #72): cu `opts.cwd` (scope-ul task-ului, care are propriul
 * tsconfig.json), `tsc --noEmit` rulează pentru configul din acel folder.
 * v2.5.32 (bug #77): detecția e AUTOMATĂ și explicită — când
 * `<scope>/tsconfig.json` există, comanda devine
 * `tsc --noEmit -p <scope>/tsconfig.json` (log: „using scoped tsconfig”).
 */
async function runVerification(root, opts) {
    const project = await detectVerificationCommand(root);
    if (!project) {
        log('nicio verificare configurată pentru acest proiect');
        return {
            ok: true,
            output: '(no verification configured)',
            command: '',
            duration: 0
        };
    }
    const command = verifyCommandString(project);
    const scopeCwd = opts?.cwd && path.resolve(opts.cwd) !== path.resolve(root)
        ? opts.cwd
        : undefined;
    // v2.5.32 FIX (bug #77): tsconfig.json propriu în folderul scope-ului →
    // verificarea folosește EXACT acel config (`-p`). Fără `-p`, tsc pornit din
    // root citește tsconfig.json din ROOT și ignoră complet configul din subfolder.
    const scopedPath = scopeCwd && project.checkScript === 'tsc --noEmit'
        ? path.join(scopeCwd, 'tsconfig.json')
        : null;
    const scoped = scopedPath && fs.existsSync(scopedPath) ? scopedPath : null;
    const scopedRel = scoped
        ? path.relative(root, scoped).replace(/\\/g, '/')
        : '';
    if (scoped)
        log('verify: using scoped tsconfig at ' + scopedRel);
    const tscBin = scoped ? resolveTscBin(scopeCwd, root) : null;
    if (scoped && !tscBin) {
        log('tsc local negăsit pentru ' + scopeCwd +
            ' — folosesc ' + project.packageManager + ' cu configul din scope');
    }
    const cwd = scoped ? scopeCwd : root;
    const label = scoped
        ? (tscBin
            ? 'node ' + path.relative(root, tscBin).replace(/\\/g, '/') +
                ' --noEmit -p ' + scopedRel
            : command + ' -p ' + scopedRel)
        : command;
    const start = Date.now();
    log('rulez verificarea: ' + label);
    try {
        const run = scoped && tscBin
            ? execFileAsync(process.execPath, [tscBin, '--noEmit', '-p', scoped], {
                cwd: root,
                timeout: exports.VERIFY_TIMEOUT_MS,
                maxBuffer: 10 * 1024 * 1024,
                windowsHide: true
            })
            : execAsync(scoped ? command + ' -p "' + scoped + '"' : command, {
                cwd: root,
                timeout: exports.VERIFY_TIMEOUT_MS,
                maxBuffer: 10 * 1024 * 1024,
                windowsHide: true
            });
        const { stdout, stderr } = await run;
        // v2.5.23: cap+coadă — sumarul erorilor (tsc/build) e la finalul output-ului
        const output = (0, payload_1.clipPayload)(String(stdout ?? '') + '\n' + String(stderr ?? ''), VERIFY_OUTPUT_MAX);
        const duration = Date.now() - start;
        log('verificare TRECUTĂ în ' + duration + 'ms (' + label + ')');
        return { ok: true, output, command: label, duration, cwd };
    }
    catch (e) {
        const raw = (0, payload_1.clipPayload)(String(e?.stdout ?? '') +
            '\n' +
            String(e?.stderr ?? '') +
            '\n' +
            (e?.message ?? String(e)), VERIFY_OUTPUT_MAX);
        // v2.5.33 FIX (bug #83): `tsc -p <scope>/tsconfig.json` a eșuat → trimitem
        // și configul minim viabil, ca modelul (Gemini) să nu ghicească ce scrie în
        // tsconfig-ul din subfolder.
        const output = scoped
            ? raw + '\n\n' + buildScopedTsconfigNudge(scopedRel)
            : raw;
        const duration = Date.now() - start;
        log('verificare EȘUATĂ în ' + duration + 'ms (' + label + ')');
        return { ok: false, output, command: label, duration, cwd };
    }
}
/* =========================================================================
 * v2.5.29 FIX 4 (bug #67) — context la erorile de comandă (tsc / build)
 * Când o comandă de verificare eșuează (ex. `npx tsc --noEmit`), modelul
 * primește output-ul complet — dar de multe ori editează la nesfârșit același
 * fișier, deși eroarea e în ALT fișier sau în tsconfig. Aici detectăm, din
 * output, fișierele menționate și dacă eroarea e de configurare, ca să putem
 * adăuga un hint explicit înainte de a trimite eroarea AI-ului.
 * ========================================================================= */
/** `src/a.ts(12,5)` (tsc) sau `src/a.ts:12:5` (alte unelte). */
const ERROR_FILE_RE = /(?:^|[\s'"`(])([\w@.\-\\/]+\.[A-Za-z][\w]{0,5})(?:\(\d+\s*,\s*\d+\)|:\d+(?::\d+)?)/gm;
/** Cale normalizată pentru comparații (separatori uniformi, fără `./`). */
function normalizeErrorPath(p) {
    return String(p ?? '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/^~\//, '')
        .trim()
        .toLowerCase();
}
/** Căile de fișier menționate de output-ul unei comenzi (unice, în ordine). */
function commandErrorFiles(output) {
    const text = String(output ?? '');
    const re = new RegExp(ERROR_FILE_RE.source, 'gm');
    const files = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(text)) !== null) {
        const key = normalizeErrorPath(m[1]);
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        files.push(m[1]);
    }
    return files;
}
/** Eroarea pare de CONFIGURARE (tsconfig / include / exclude / rootDir)? */
function looksLikeTsconfigError(output) {
    const text = String(output ?? '');
    return (/tsconfig/i.test(text) ||
        /no inputs were found in config file/i.test(text) ||
        /rootdir/i.test(text) ||
        (/\binclude\b/i.test(text) && /\bexclude\b/i.test(text)));
}
/**
 * Blocul de hint-uri adăugat la eroarea unei comenzi trimise AI-ului:
 *  - eroarea e în ALT fișier decât cel editat ultima dată;
 *  - eroarea e de configurare → verifică include/exclude din tsconfig.json.
 *  - v2.5.32 (bug #76): TS6059 → tsconfig.json separat în subfolder, nu editarea
 *    la infinit a tsconfig.json din ROOT.
 * Întoarce '' când nu e nimic de adăugat (comportamentul de dinainte rămâne).
 */
function buildCommandErrorHints(command, output, editedFile, scope, opts) {
    const text = String(output ?? '');
    if (!text.trim())
        return '';
    const hints = [];
    const edited = editedFile ? normalizeErrorPath(editedFile) : '';
    if (edited) {
        const others = commandErrorFiles(text).filter((f) => normalizeErrorPath(f) !== edited);
        if (others.length) {
            hints.push('The error is in ' + others[0] + ', not in the file you edited.');
        }
    }
    if (looksLikeTs6059(text)) {
        // v2.5.32 FIX (bug #76): „Check tsconfig.json include/exclude" e un sfat
        // GREȘIT aici — omul edita root tsconfig.json la nesfârșit.
        // v2.5.36 FIX (bug #87): apelantul care injectează el template-ul proactiv
        // (buildTs6059FirstFailureInjection) sare peste hint ca să nu dubleze textul.
        if (!opts?.skipTs6059Hint)
            hints.push(buildTs6059Hint(text, scope));
    }
    else if (looksLikeTsconfigError(text)) {
        hints.push('Check tsconfig.json include/exclude.');
    }
    if (!hints.length)
        return '';
    return '\n\nHINT from "' + command + '":\n- ' + hints.join('\n- ');
}
/* =========================================================================
 * v2.5.32 FIX (bug #76) — hint TS6059 (rootDir + subfolder)
 * `error TS6059: File 'C:/x/bootcamp-test/index.ts' is not under 'rootDir'
 * 'C:/x/src'.` înseamnă că tsc a folosit tsconfig.json din ROOT (are `rootDir`
 * setat) și a exclus fișierele din subfolder. Modelul „repara" asta editând la
 * infinit tsconfig.json din root (sau pe cel din subfolder, fără efect când
 * comanda pornește din root). Hint-ul spune fix ce trebuie făcut: tsconfig.json
 * separat în subfolder + `tsc -p <subfolder>/tsconfig.json`.
 * ========================================================================= */
/** `File 'C:/x/bootcamp-test/index.ts' is not under 'rootDir'` (primul path). */
const TS6059_FILE_RE = /TS6059:[^\n]*?\bFile\s+['"]([^'"]+)['"]/i;
/** Eroarea asta e TS6059? */
function looksLikeTs6059(output) {
    return /TS6059/.test(String(output ?? ''));
}
/**
 * Folderul (relativ, cu `/`) în care trebuie creat tsconfig.json: întâi căutăm
 * o intrare din scope în calea din eroare, altfel părintele fișierului.
 */
function ts6059Folder(output, scope) {
    const m = TS6059_FILE_RE.exec(String(output ?? ''));
    const file = m ? String(m[1]).replace(/\\/g, '/') : '';
    const lower = file.toLowerCase();
    if (scope && scope.length) {
        for (const s of scope) {
            const n = String(s ?? '')
                .replace(/\\/g, '/')
                .replace(/^\.\//, '')
                .replace(/\/+$/, '');
            if (!n)
                continue;
            const i = lower.indexOf(n.toLowerCase());
            if (i >= 0)
                return file.slice(i, i + n.length);
        }
    }
    const parts = file.split('/').filter(Boolean);
    if (parts.length >= 2)
        return parts[parts.length - 2];
    return '<scope>';
}
/**
 * v2.5.36 FIX (bug #87): calea relativă a tsconfig.json care trebuie scrisă,
 * derivată din output-ul TS6059 (ex. `bootcamp-test/tsconfig.json`) — sau
 * `<scope>/tsconfig.json` când folderul nu poate fi dedus din eroare.
 */
function ts6059TsconfigRel(output, scope) {
    return ts6059Folder(output, scope) + '/tsconfig.json';
}
/**
 * v2.5.33 FIX (bug #81): template-ul tsconfig EXACT pe care modelul trebuie să-l
 * scrie în subfolder. Gemini rescria tsconfig.json de 4 ori cu versiuni greșite
 * (rootDir/outDir/extends de prisos); un sfat vag nu ajuta — dăm conținutul
 * exact, gata de scris.
 */
exports.TS6059_TSCONFIG_JSON = [
    '{',
    '  "compilerOptions": {',
    '    "target": "ES2020",',
    '    "module": "commonjs",',
    '    "strict": true,',
    '    "esModuleInterop": true,',
    '    "skipLibCheck": true,',
    '    "forceConsistentCasingInFileNames": true',
    '  },',
    '  "include": ["*.ts"]',
    '}'
].join('\n');
/** Hint-ul TS6059 (vezi secțiunea de mai sus). */
function buildTs6059Hint(output, scope) {
    const folder = ts6059Folder(output, scope);
    return ('TS6059 means ROOT tsconfig.json has \'rootDir\' set and excludes files outside it.\n' +
        'The error is in the tsconfig.json of ' +
        folder +
        '/, NOT in the .ts files — do NOT rewrite the .ts files (index.ts, utils.ts).\n' +
        'BEST FIX: create a separate tsconfig.json inside ' +
        folder +
        '/ with EXACTLY this content:\n' +
        exports.TS6059_TSCONFIG_JSON +
        '\n' +
        'Then run:\n' +
        '  npx tsc --noEmit -p ' +
        folder +
        '/tsconfig.json\n' +
        'Do NOT add rootDir, outDir, extends, or any other fields.\n' +
        'Do NOT edit the root tsconfig.json again.');
}
/**
 * v2.5.33 FIX (bug #82): textul injectat (în locul nudge-ului generic) când
 * același `tsconfig.json` a fost rescris de 2 ori și eroarea e tot TS6059.
 * Trimite template-ul EXACT, nu încă o sugestie.
 *
 * v2.5.36 FIX (bug #87): `firstFailure` schimbă antetul pentru injectarea
 * PROACTIVĂ de la PRIMA eroare TS6059 (fără nicio rescriere de tsconfig.json):
 * spune explicit că eroarea e în tsconfig.json, NU în fișierele .ts.
 */
function buildTsconfigRewriteInjection(relPath, firstFailure = false) {
    const rel = String(relPath ?? '').replace(/\\/g, '/');
    const header = firstFailure
        ? '⚠️ TS6059: the error is in tsconfig.json, NOT in the .ts files.\n' +
            'Do NOT rewrite index.ts/utils.ts — use the exact template below.\n' +
            'Write ' +
            rel +
            ' with EXACTLY this content (nothing else):\n'
        : '⚠️ You have rewritten ' +
            rel +
            ' twice and the TS6059 error is still there.\n' +
            'Write ' +
            rel +
            ' with EXACTLY this content (nothing else):\n';
    return (header +
        exports.TS6059_TSCONFIG_JSON +
        '\n' +
        'Then run: npx tsc --noEmit -p ' +
        rel +
        '\n' +
        'Do NOT add rootDir, outDir, extends, or any other fields.\n' +
        'Do NOT edit the root tsconfig.json again.');
}
/**
 * v2.5.36 FIX (bug #87): injectarea PROACTIVĂ de la PRIMA eroare TS6059 —
 * template-ul exact + „nu rescrie .ts-urile". În testul HARD MODE (7/10/2026)
 * Gemini a scris tsconfig.json o singură dată, apoi a rescris index.ts și
 * utils.ts de 4+ ori, crezând că acolo e problema: fix-urile #82/#85 (care
 * așteptau 2 rescrieri de tsconfig.json) nu se declanșau niciodată.
 */
function buildTs6059FirstFailureInjection(output, scope) {
    return buildTsconfigRewriteInjection(ts6059TsconfigRel(output, scope), true);
}
/**
 * v2.5.33 FIX (bug #83): nudge-ul adăugat la EȘECUL unei verificări `tsc -p
 * <scope>/tsconfig.json` — configul minim viabil, ca modelul să nu ghicească
 * ce câmpuri să pună în tsconfig-ul din subfolder.
 */
function buildScopedTsconfigNudge(scopeTsconfigRel) {
    return ('Check ' +
        String(scopeTsconfigRel ?? '').replace(/\\/g, '/') +
        '. Minimum viable config is:\n' +
        '{ "compilerOptions": { "target": "ES2020", "module": "commonjs", ' +
        '"strict": true, "esModuleInterop": true, "skipLibCheck": true }, ' +
        '"include": ["*.ts"] }');
}
const MSG_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const GIT_HASH_RE = /^[0-9a-f]{4,40}$/i;
const GIT_TIMEOUT_MS = 120000;
/** Rulează o comandă git (FĂRĂ shell — argumente separate, fără injectări). */
async function gitRun(root, args, timeoutMs = GIT_TIMEOUT_MS) {
    try {
        const r = await execFileAsync('git', args, {
            cwd: root,
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true
        });
        return {
            ok: true,
            stdout: String(r.stdout ?? ''),
            stderr: String(r.stderr ?? '')
        };
    }
    catch (e) {
        return {
            ok: false,
            stdout: String(e?.stdout ?? ''),
            stderr: String(e?.stderr ?? ''),
            error: e?.message ?? String(e)
        };
    }
}
/**
 * Commit cu fallback de identitate: dacă repo-ul nu are user.name/user.email
 * configurat (sau semnarea GPG e pornită fără chei), reîncearcă cu identitatea
 * de bot „Freekit” — altfel checkpoint-ul ar eșua tăcut pe astfel de medii.
 */
async function gitCommit(root, message, allowEmpty) {
    const args = ['commit', '-m', message, '--no-verify'];
    if (allowEmpty)
        args.push('--allow-empty');
    const first = await gitRun(root, args);
    if (first.ok)
        return true;
    const fallback = await gitRun(root, [
        '-c', 'user.name=Freekit',
        '-c', 'user.email=freekit@local',
        '-c', 'commit.gpgSign=false',
        ...args
    ]);
    if (!fallback.ok) {
        log('git commit a eșuat: ' + (fallback.stderr || fallback.error || ''));
    }
    return fallback.ok;
}
/** v1.5.0: folder în care am încercat deja `git init` (o singură dată). */
const INIT_ATTEMPTED = new Set();
/**
 * v1.5.0 — repo-ul git există? Dacă nu, îl inițializează o singură dată
 * (`git init`), ca checkpoint-urile să funcționeze și în foldere fără git.
 * La init se scrie și un `.gitignore` minimal (doar dacă lipsește), ca
 * `git add -A` să nu înghită node_modules/dist la primul commit.
 */
async function ensureGitRepo(root) {
    try {
        const rev = await gitRun(root, ['rev-parse', '--git-dir']);
        if (rev.ok && rev.stdout.trim())
            return { ok: true, initialized: false };
        const key = path.normalize(root).toLowerCase();
        if (INIT_ATTEMPTED.has(key)) {
            return {
                ok: false,
                initialized: false,
                error: rev.error || rev.stderr || 'not a git repo'
            };
        }
        INIT_ATTEMPTED.add(key);
        const init = await gitRun(root, ['init']);
        if (!init.ok) {
            const detail = (init.stderr || init.error || '').split('\n')[0];
            log('git init a eșuat în ' + root + ': ' + detail);
            return {
                ok: false,
                initialized: false,
                error: detail || 'git init failed (is git missing?)'
            };
        }
        // .gitignore minimal la prima inițializare (nu atingem unul existent)
        const ignorePath = path.join(root, '.gitignore');
        if (!fs.existsSync(ignorePath)) {
            try {
                fs.writeFileSync(ignorePath, [
                    '# creat automat de Freekit (checkpoint-uri git)',
                    'node_modules/',
                    'dist/',
                    'build/',
                    'out/',
                    '.astro/',
                    '.next/',
                    '.cache/',
                    '*.vsix',
                    '*.log',
                    ''
                ].join('\n'), 'utf8');
            }
            catch (e) {
                log('scrierea .gitignore a eșuat: ' + (e?.message ?? String(e)));
            }
        }
        log('git init automat în ' + root);
        return { ok: true, initialized: true };
    }
    catch (e) {
        log('ensureGitRepo a eșuat: ' + (e?.message ?? String(e)));
        return { ok: false, initialized: false, error: e?.message ?? String(e) };
    }
}
/**
 * Creează un checkpoint înainte de fiecare prompt.
 * Dacă working tree-ul nu e clean, commit-uiește tot ca checkpoint (marker
 * „freekit-prompt:<id>”); dacă e clean, creează un commit gol-marker, ca
 * fiecare prompt să aibă un id unic de restore.
 * v1.5.0: cu opts.autoInit, un folder care nu e (încă) repo git primește
 * `git init` automat — altfel funcția întorcea tăcut null și butonul ⟲
 * de restore nu apărea niciodată.
 */
async function createPromptCheckpoint(root, messageId, promptText, opts) {
    try {
        // 1. doar în repo-uri git; v1.5.0: init automat dacă lipsește
        let repoInitialized = false;
        const gitDir = await gitRun(root, ['rev-parse', '--git-dir']);
        if (!gitDir.ok || !gitDir.stdout.trim()) {
            if (!opts?.autoInit)
                return null;
            const ens = await ensureGitRepo(root);
            if (!ens.ok) {
                log('checkpoint: ensureGitRepo a eșuat — ' + (ens.error ?? 'necunoscut'));
                return null;
            }
            repoInitialized = ens.initialized;
        }
        // 2. id sigur de mesaj (ajunge în mesajul commit-ului)
        const safeId = MSG_ID_RE.test(String(messageId ?? ''))
            ? String(messageId)
            : String(messageId ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) ||
                'auto' + Date.now().toString(36);
        // 3. working tree dirty?
        const status = await gitRun(root, ['status', '--porcelain']);
        if (!status.ok)
            return null;
        const wasClean = !status.stdout.trim();
        // 4. commit de checkpoint (tot working tree-ul sau un marker gol)
        if (!wasClean) {
            const add = await gitRun(root, ['add', '-A']);
            if (!add.ok) {
                log('checkpoint: git add a eșuat — ' + (add.stderr || add.error || ''));
                return null;
            }
        }
        // allowEmpty=true pe ambele ramuri: robust la stări „dirty” doar în
        // metadate (submodule) unde commit-ul normal nu ar avea ce stoca
        if (!(await gitCommit(root, 'freekit-prompt:' + safeId, true))) {
            return null;
        }
        // 5. hash-ul commit-ului
        const head = await gitRun(root, ['rev-parse', 'HEAD']);
        const id = head.stdout.trim();
        if (!head.ok || !GIT_HASH_RE.test(id))
            return null;
        log('checkpoint ' + id.slice(0, 7) + ' (' + safeId + ', wasClean=' + wasClean + ')');
        return {
            id,
            messageId,
            text: String(promptText ?? '').slice(0, 80),
            timestamp: Date.now(),
            wasClean,
            repoInitialized
        };
    }
    catch (e) {
        log('checkpoint failed: ' + (e?.message ?? String(e)));
        return null;
    }
}
/**
 * Revine la un checkpoint. Înainte de reset, starea curentă (dacă e dirty)
 * este salvată ca backup-commit „freekit-backup-before-restore:<ts>”, deci
 * nimic nu se pierde — backupId e întors pentru a putea reveni la ea.
 * Fiindcă backup-ul înregistrează TOATE fișierele neignorate, reset --hard
 * readuce working tree-ul exact la starea checkpoint-ului: fișierele noi
 * create după checkpoint sunt șterse de reset (recuperabile din backupId).
 * Fișierele ignorate (node_modules etc.) nu sunt atinse.
 */
async function restoreToCheckpoint(root, checkpointId) {
    try {
        if (!GIT_HASH_RE.test(String(checkpointId ?? ''))) {
            return { ok: false, error: 'invalid checkpoint id: ' + checkpointId };
        }
        const gitDir = await gitRun(root, ['rev-parse', '--git-dir']);
        if (!gitDir.ok)
            return { ok: false, error: 'not a git project' };
        // 1. backup al stării curente (safety) — doar dacă working tree-ul e dirty
        let backupId;
        const status = await gitRun(root, ['status', '--porcelain']);
        if (status.ok && status.stdout.trim()) {
            const add = await gitRun(root, ['add', '-A']);
            if (!add.ok) {
                return { ok: false, error: 'git add -A failed: ' + (add.stderr || add.error || '') };
            }
            if (!(await gitCommit(root, 'freekit-backup-before-restore:' + Date.now(), false))) {
                return { ok: false, error: 'the backup commit failed (check git user.name/email)' };
            }
            const head = await gitRun(root, ['rev-parse', 'HEAD']);
            if (head.ok && GIT_HASH_RE.test(head.stdout.trim())) {
                backupId = head.stdout.trim();
            }
        }
        // 2. reset --hard la checkpoint (fix față de schiță: un SINGUR reset)
        const reset = await gitRun(root, ['reset', '--hard', checkpointId]);
        if (!reset.ok) {
            const detail = (reset.stderr || reset.error || '').split('\n')[0];
            return { ok: false, error: 'git reset --hard failed: ' + detail };
        }
        // 3. raportează eventualele fișiere neignorate rămase după reset
        // (de regulă 0 — reset-ul șterge tot ce nu e în checkpoint)
        const after = await gitRun(root, ['status', '--porcelain']);
        const leftoverUntracked = after.ok
            ? after.stdout
                .split('\n')
                .filter((l) => l.startsWith('?? '))
                .map((l) => l.slice(3).trim())
                .filter(Boolean)
            : [];
        log('restored to checkpoint ' + checkpointId.slice(0, 7) +
            (backupId ? ' (backup ' + backupId.slice(0, 7) + ')' : '') +
            ', untracked rămase: ' + leftoverUntracked.length);
        return { ok: true, backupId, leftoverUntracked };
    }
    catch (e) {
        log('restore failed: ' + (e?.message ?? String(e)));
        return { ok: false, error: e?.message ?? String(e) };
    }
}
//# sourceMappingURL=verifier.js.map