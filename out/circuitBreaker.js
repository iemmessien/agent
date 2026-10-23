"use strict";
/* =========================================================================
 * v2.5.11 FIX (bug #33) — Circuit breaker pe eșecuri consecutive
 * Un tool care eșuează repetat (write_file, edit_file, run_command) ținea
 * bucla agentică până la 40/40 de iterații, consumând CPU/RAM/timp masiv
 * (mai ales Ollama local pe hardware slab). Aici ținem contorul de eșecuri
 * CONSECUTIVE ale ACELUIAȘI tool: un succes (al oricărui tool) resetează
 * contorul (e progres real); la 3 eșecuri consecutive bucla se oprește.
 * ========================================================================= */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TsconfigRewriteTracker = exports.TSCONFIG_REWRITE_WINDOW_MS = exports.SameErrorTracker = exports.MAX_SAME_ERROR_RETRIES = exports.EditLoopDetector = exports.EDIT_TOOLS = exports.EDIT_LOOP_NUDGE_EVERY = exports.EDIT_LOOP_THRESHOLD = exports.GLOBAL_LOOP_NUDGE_EVERY = exports.GLOBAL_LOOP_THRESHOLD = exports.CircuitBreaker = exports.CIRCUIT_BREAKER_GRACE = exports.CIRCUIT_BREAKER_THRESHOLD = void 0;
exports.buildGlobalLoopNudge = buildGlobalLoopNudge;
exports.buildEditLoopNudge = buildEditLoopNudge;
exports.buildCircuitBreakerHint = buildCircuitBreakerHint;
exports.buildCircuitBreakerMessage = buildCircuitBreakerMessage;
exports.buildLoopCircuitBreakerMessage = buildLoopCircuitBreakerMessage;
exports.isTsconfigPath = isTsconfigPath;
const unixTranslate_1 = require("./unixTranslate");
/** Câte eșecuri consecutive ale aceluiași tool opresc bucla agentică. */
exports.CIRCUIT_BREAKER_THRESHOLD = 3;
/**
 * v2.5.55 (FIX 3): la prag NU mai oprim direct. Îi trimitem modelului ultima
 * eroare + echivalentele Windows și îi mai dăm CIRCUIT_BREAKER_GRACE eșecuri
 * consecutive. Raportul din 8 Oct 2026: 3 × „'find' is not recognized" au oprit
 * task-ul înainte ca modelul să apuce să încerce varianta Windows.
 */
exports.CIRCUIT_BREAKER_GRACE = 3;
/** Contor de eșecuri consecutive per tool. O instanță = o buclă agentică
 *  (un mesaj nou ⇒ instanță nouă ⇒ contorul pornește de la 0). */
class CircuitBreaker {
    consecutiveFailures = 0;
    lastFailedTool = '';
    /** v2.5.55 (FIX 3): hint-ul de la prag a fost deja trimis (nu îl repetăm). */
    hinted = false;
    /** Înregistrează rezultatul unui tool call:
     *  succes ⇒ reset (chiar dacă e alt tool sau același);
     *  eșec al ACELUIAȘI tool ⇒ increment;
     *  eșecul ALTUI tool ⇒ numărătoare nouă, pentru acel tool. */
    record(toolName, ok) {
        if (ok) {
            this.consecutiveFailures = 0;
            this.lastFailedTool = '';
            this.hinted = false;
            return { consecutiveFailures: 0, warn: false, hint: false, triggered: false };
        }
        if (toolName === this.lastFailedTool) {
            this.consecutiveFailures++;
        }
        else {
            this.consecutiveFailures = 1;
            this.lastFailedTool = toolName;
            this.hinted = false;
        }
        const hint = this.consecutiveFailures === exports.CIRCUIT_BREAKER_THRESHOLD && !this.hinted;
        if (hint)
            this.hinted = true;
        return {
            consecutiveFailures: this.consecutiveFailures,
            warn: this.consecutiveFailures === 2,
            hint,
            // v2.5.55: pragul de oprire se atinge abia după perioada de grație
            triggered: this.consecutiveFailures >= exports.CIRCUIT_BREAKER_THRESHOLD + exports.CIRCUIT_BREAKER_GRACE
        };
    }
}
exports.CircuitBreaker = CircuitBreaker;
/* =========================================================================
 * v2.5.29 FIX 2 (bug #67) — Loop detection per FIȘIER editat
 * Circuit breaker-ul de mai sus numără doar eșecuri CONSECUTIVE ale ACELUIAȘI
 * tool, iar un succes (al oricărui tool) resetează contorul — deci bucla
 * „edit_file (reușit) → run_command (eșuat) → edit_file (reușit) → …" nu-l
 * declanșează deloc (7 iterații pierdute pe tsconfig.json în logul v2.5.28).
 * Aici numărăm separat, per fișier, CÂTE ÎNCERCĂRI de editare a primit în
 * același mesaj (reușite sau nu): de la 4 încercări pe același fișier, eroarea
 * de la tsc aproape sigur NU se rezolvă editând acel fișier, deci trimitem un
 * nudge de strategie (vezi buildEditLoopNudge).
 * ========================================================================= */
/**
 * v2.5.30 FIX 3 (bug #70) — Loop detection CROSS-FILE (contor global)
 * Contorul per fișier de mai jos rata bucla reală: modelul edita tsconfig.json
 * de 4 ori (prins de nudge), apoi trecea pe selectors.ts ⇒ contorul fișierului
 * nou pornea de la 0 și șirul de editări continua nevăzut. Aici numărăm
 * TOTALUL încercărilor de scriere/editare din mesaj, indiferent de fișier: de
 * la GLOBAL_LOOP_THRESHOLD, dacă printre ele sunt și fișiere din AFARA
 * scope-ului task-ului, trimitem un nudge global de oprire.
 */
/** Câte scrieri/editări în TOTAL (orice fișier) declanșează nudge-ul global. */
exports.GLOBAL_LOOP_THRESHOLD = 8;
/** Nudge-ul global se repetă din 2 în 2 peste prag (nu la fiecare pas). */
exports.GLOBAL_LOOP_NUDGE_EVERY = 2;
/** Nudge-ul global trimis AI-ului când scrie prea multe fișiere (multe în afara scope-ului). */
function buildGlobalLoopNudge(count, scope) {
    const scopeLabel = scope && scope.length ? scope.join(', ') : '(not detected — ask the user)';
    return ('⚠️ You have written/edited ' +
        count +
        ' files in this message, many outside the task scope.\n' +
        'STOP. Re-read the task. Only modify files inside ' +
        scopeLabel +
        '. If you cannot complete the task, report the blocker and stop.');
}
/** Câte încercări de editare pe ACELAȘI fișier declanșează nudge-ul. */
exports.EDIT_LOOP_THRESHOLD = 4;
/** Nudge-ul se repetă din 2 în 2 încercări peste prag (nu la fiecare pas). */
exports.EDIT_LOOP_NUDGE_EVERY = 2;
/** Uneltele care modifică fișiere (fiecare = o „încercare de editare"). */
exports.EDIT_TOOLS = new Set([
    'edit_file',
    'write_file',
    'write_files'
]);
/** Cheia de comparație a căilor (separatori uniformi, case-insensitive). */
function editKey(rel) {
    return String(rel ?? '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .trim()
        .toLowerCase();
}
/** Nudge-ul de strategie trimis AI-ului când tot editează același fișier. */
function buildEditLoopNudge(file, count) {
    return ('⚠️ You have edited ' +
        file +
        ' ' +
        count +
        ' times. The tsc error is probably not fixable by editing this file.\n' +
        'Try: (1) read the error carefully, (2) check if the error is in another ' +
        'file, (3) check the tsconfig include/exclude, (4) if you cannot fix it, ' +
        'report the error and stop.');
}
/**
 * Contor de încercări de editare per fișier + contor GLOBAL cross-file
 * (v2.5.30, bug #70). O instanță = o buclă agentică (un mesaj nou ⇒ instanță
 * nouă ⇒ contoarele pornesc de la 0).
 *
 * Reset:
 *  - mesaj nou (instanță nouă / `reset()`);
 *  - `run_command` REUȘIT după o editare REUȘITĂ = succes real ⇒ se șterge
 *    contorul fișierului editat.
 * NU se resetat la editarea ALTUI fișier — contoarele sunt per fișier, deci
 * întoarcerea la un fișier deja editat continuă numărătoarea lui.
 */
class EditLoopDetector {
    attempts = new Map();
    /** Ultimul fișier editat CU SUCCES (pentru regula de „succes real"). */
    lastEditedFile;
    /** v2.5.30 (bug #70): totalul încercărilor din mesaj (orice fișier). */
    totalAttempts = 0;
    /** v2.5.30 (bug #70): câte încercări au vizat fișiere din afara scope-ului. */
    outsideScopeAttempts = 0;
    /**
     * v2.5.31 (bug #74): fișierele care au primit deja nudge-ul de strategie.
     * Un nudge care nu oprește modelul nu-și atinge scopul: dacă următoarea
     * încercare de editare e TOT pe un fișier „nudged", apelantul oprește bucla
     * (circuit breaker direct), în loc să-i mai dea nudge-uri la nesfârșit.
     */
    nudged = new Set();
    /**
     * Înregistrează o ÎNCERCARE de editare (reușită sau nu) pe un fișier.
     * `inScope` (opțional) spune dacă fișierul e în scope-ul task-ului; când
     * lipsește sau e `false`, încercarea intră în contorul global de „din afara
     * scope-ului" (scope nedeterminat ⇒ tratăm ca în afara scope-ului).
     */
    recordAttempt(file, inScope) {
        const key = editKey(file);
        if (!key)
            return { count: 0 };
        this.totalAttempts++;
        if (inScope !== true)
            this.outsideScopeAttempts++;
        const count = (this.attempts.get(key) ?? 0) + 1;
        this.attempts.set(key, count);
        if (count >= exports.EDIT_LOOP_THRESHOLD &&
            (count - exports.EDIT_LOOP_THRESHOLD) % exports.EDIT_LOOP_NUDGE_EVERY === 0) {
            this.nudged.add(key);
            return { count, nudge: buildEditLoopNudge(file, count) };
        }
        return { count };
    }
    /**
     * v2.5.31 (bug #74): fișierul a primit deja nudge-ul de strategie în acest
     * mesaj? `true` ⇒ următoarea editare a lui declanșează circuit breaker-ul
     * direct (vezi chatView), nu încă un nudge.
     */
    wasNudged(file) {
        const key = editKey(file);
        return !!key && this.nudged.has(key);
    }
    /**
     * v2.5.30 (bug #70): starea contorului GLOBAL (cross-file). Întoarce
     * nudge-ul de oprire doar când totalul a atins pragul ȘI există încercări în
     * afara scope-ului (o progresie normală, toată în scope, nu e blocată).
     */
    globalOutcome(scope) {
        const outcome = {
            total: this.totalAttempts,
            outsideScope: this.outsideScopeAttempts
        };
        if (this.totalAttempts >= exports.GLOBAL_LOOP_THRESHOLD &&
            this.outsideScopeAttempts > 0 &&
            (this.totalAttempts - exports.GLOBAL_LOOP_THRESHOLD) % exports.GLOBAL_LOOP_NUDGE_EVERY === 0) {
            outcome.nudge = buildGlobalLoopNudge(this.totalAttempts, scope);
        }
        return outcome;
    }
    /** Editare REUȘITĂ — reținem fișierul pentru regula de „succes real". */
    recordEditSuccess(file) {
        const key = editKey(file);
        if (key)
            this.lastEditedFile = key;
    }
    /**
     * `run_command` REUȘIT după o editare reușită = succes real ⇒ contorul
     * fișierului editat se resetează. Întoarce calea resetată (pentru log).
     */
    recordCommandSuccess() {
        const file = this.lastEditedFile;
        this.lastEditedFile = undefined;
        if (!file)
            return undefined;
        this.attempts.delete(file);
        // v2.5.31 (bug #74): succes real ⇒ fișierul iese și din lista „nudged"
        this.nudged.delete(file);
        return file;
    }
    /** Câte încercări de editare are fișierul în mesajul curent. */
    count(file) {
        return this.attempts.get(editKey(file)) ?? 0;
    }
    /** Reset complet (mesaj nou). */
    reset() {
        this.attempts.clear();
        this.lastEditedFile = undefined;
        this.totalAttempts = 0;
        this.outsideScopeAttempts = 0;
        this.nudged.clear();
    }
}
exports.EditLoopDetector = EditLoopDetector;
/**
 * v2.5.55 (FIX 3): mesajul trimis MODELULUI (nu utilizatorului) la primul prag
 * de eșecuri consecutive — în loc să oprim bucla, îi spunem ce anume a eșuat de
 * 3 ori la rând și cum se scrie comanda corect pe Windows. Dacă nu se conformează
 * în CIRCUIT_BREAKER_GRACE pași, bucla se oprește (buildCircuitBreakerMessage).
 */
function buildCircuitBreakerHint(toolName, error, failures, command = '') {
    const lastError = String(error ?? 'unknown error').slice(0, 500);
    const parts = [
        '⚠️ STOP — the SAME action (' + toolName + ') failed ' + failures +
            ' times in a row. Do NOT repeat it: change the APPROACH.',
        'Last error:\n```\n' + lastError + '\n```'
    ];
    // Când eșecul vine dintr-o comandă Unix (sau de la o comandă inexistentă),
    // dăm tabelul de echivalențe Windows — cauza reală din raportul de bug.
    const unixFound = [];
    if (process.platform === 'win32' && toolName === 'run_command') {
        for (const name of [
            ...(0, unixTranslate_1.findUnixCommands)(command),
            ...(0, unixTranslate_1.findUnixCommands)(lastError)
        ]) {
            if (unixFound.indexOf(name) < 0)
                unixFound.push(name);
        }
    }
    if (unixFound.length || toolName === 'run_command') {
        const list = unixFound.length
            ? unixFound
            : ['find', 'grep', 'ls', 'pwd', 'cat', 'rm'];
        parts.push('This is a WINDOWS environment (win32). Unix commands (' +
            list.join(', ') +
            ') do NOT work in cmd/PowerShell. Use the Windows equivalents:\n' +
            (0, unixTranslate_1.unixToWindowsLines)(list) +
            '\nOr use the built-in tools: search_files(pattern), list_files(dir), read_file(path).');
    }
    parts.push('You have ' + exports.CIRCUIT_BREAKER_GRACE +
        ' more attempts with this tool. After that the loop stops and you must reply with PLAIN TEXT.\n' +
        'If the command does not exist on this machine, do NOT retry it — use the equivalent above.');
    return parts.join('\n\n');
}
/** Mesajul clar afișat în chat când circuit breaker-ul se declanșează:
 *  numele tool-ului, ultima eroare (max 500 de caractere) și 3 sugestii. */
function buildCircuitBreakerMessage(toolName, error) {
    const lastError = (error || 'unknown error').slice(0, 500);
    return ('⛔ **Stopped — the AI is stuck.**\n\n' +
        'The tool `' + toolName + '` failed **' +
        (exports.CIRCUIT_BREAKER_THRESHOLD + exports.CIRCUIT_BREAKER_GRACE) +
        ' times in a row** (the AI got a recovery hint after ' +
        exports.CIRCUIT_BREAKER_THRESHOLD +
        ' and did not use it).\n\n' +
        '**Last error:**\n' +
        '```\n' + lastError + '\n```\n\n' +
        '**Try:**\n' +
        '- Break the task into smaller steps (one file at a time)\n' +
        '- Switch to a different provider (⋯ → model chip)\n' +
        '- Check that the file paths exist and are writable' +
        (process.platform === 'win32' && /not recognized|nu este recunoscut/i.test(lastError)
            ? '\n- The command does not exist on Windows — ask for the Windows equivalent ' +
                '(find → dir /s /b, grep → findstr, ls → dir, pwd → cd, cat → type)'
            : ''));
}
/**
 * v2.5.31 (bug #74): mesajul afișat când circuit breaker-ul de BUCLĂ se
 * declanșează — modelul a editat din nou un fișier imediat după nudge-ul de
 * strategie (deci nudge-ul nu l-a oprit).
 */
function buildLoopCircuitBreakerMessage(file, count, error) {
    const lastError = String(error ?? '').slice(0, 500);
    return ('⛔ **Stopped — the AI is stuck in a loop.**\n\n' +
        '`' + file + '` was edited **' + count +
        ' times**, and the AI edited it AGAIN right after being told to change ' +
        'strategy — the edit was not executed.\n' +
        (lastError
            ? '\n**Last error:**\n```\n' + lastError + '\n```\n'
            : '') +
        '\n**Try:**\n' +
        '- Write "continue" with a hint (e.g. "the error is in another file")\n' +
        '- Break the task into smaller steps (one file at a time)\n' +
        '- Switch to a different provider (⋯ → model chip)');
}
/* =========================================================================
 * v2.5.33 FIX (bug #84) — stop după 5 eșecuri pe ACELAȘI tip de eroare
 * Gemini rescria `bootcamp-test/tsconfig.json` de 4 ori la rând, cu același
 * `TS6059` de fiecare dată: eroarea nu e de cod, e de configurare, deci a N-a
 * încercare identică nu are cum să reușească. Numărăm eșecurile CONSECUTIVE pe
 * același cod `TSxxxx`; la prag, chatView oprește bucla și cere intervenția
 * manuală. Succesul (verificare verde / comandă reușită) rupe seria.
 * ========================================================================= */
/** Câte eșecuri consecutive pe același cod de eroare opresc task-ul. */
exports.MAX_SAME_ERROR_RETRIES = 5;
class SameErrorTracker {
    type = '';
    count = 0;
    /**
     * Înregistrează un eșec. Întoarce mesajul de blocare când același cod
     * `TSxxxx` a eșuat de MAX_SAME_ERROR_RETRIES ori consecutiv, altfel ''.
     * Un output fără cod `TS` rupe seria (nu mai e „același tip de eroare").
     */
    note(output) {
        const m = /TS(\d{4})/.exec(String(output ?? ''));
        if (!m) {
            this.reset();
            return '';
        }
        const type = 'TS' + m[1];
        this.count = type === this.type ? this.count + 1 : 1;
        this.type = type;
        if (this.count >= exports.MAX_SAME_ERROR_RETRIES) {
            return ('Task blocked after ' + exports.MAX_SAME_ERROR_RETRIES + ' retries on ' + type +
                '. Manual intervention needed.');
        }
        return '';
    }
    /** Succes real (verificare verde / comandă reușită) ⇒ seria se rupe. */
    reset() {
        this.type = '';
        this.count = 0;
    }
    /** Tipul de eroare urmărit acum (ex. „TS6059"), pentru log. */
    get currentType() {
        return this.type;
    }
    /** Câte eșecuri consecutive pe tipul curent (pentru log). */
    get currentCount() {
        return this.count;
    }
}
exports.SameErrorTracker = SameErrorTracker;
/* =========================================================================
 * v2.5.34 FIX (bug #85) — rescrierile de tsconfig.json se numără PESTE chat-uri
 * Fix-ul #82 („tsconfig rescris de 2 ori ⇒ template exact") număra doar în
 * chatul curent, dar rotirea proactivă a chatului (v2.5.23, implicit la 4
 * rezultate de unealtă) resetează contorul: în testul HARD MODE (7/10/2026),
 * Gemini a scris tsconfig.json O DATĂ în fiecare din 8 chat-uri consecutive,
 * deci #82 nu s-a declanșat niciodată. Aici ținem minte ultimele scrieri per
 * cale PESTE chat-uri, într-o fereastră de 10 minute: la a 2-a scriere a
 * aceluiași tsconfig.json chatView injectează template-ul exact (#82), fără să
 * aștepte ca ambele scrieri să nimerească în același chat.
 * ========================================================================= */
/** Fereastra în care două rescrieri ale aceluiași tsconfig.json = aceeași buclă. */
exports.TSCONFIG_REWRITE_WINDOW_MS = 10 * 60_000;
/** Calea e un `tsconfig.json`? (acceptă `\` și `/`, la orice adâncime) */
function isTsconfigPath(p) {
    return /(^|\/)tsconfig\.json$/i.test(String(p ?? '').replace(/\\/g, '/').trim());
}
/** Cheia normalizată a unui tsconfig.json (separatori `/`, fără `./`), altfel ''. */
function tsconfigKey(p) {
    const norm = String(p ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    return isTsconfigPath(norm) ? norm : '';
}
/**
 * Ultimele rescrieri ale fiecărui `tsconfig.json`, cu timestamp — PERSISTENT
 * peste rotirile de chat (o instanță = un task; chatView îl resetează doar la
 * începutul unui mesaj nou de user, NU în resetVerifyState()).
 */
class TsconfigRewriteTracker {
    /** cale normalizată → timestamp-urile scrierilor din fereastra curentă */
    writes = new Map();
    /**
     * Înregistrează o scriere a lui `path`. Timestamp-urile mai vechi de
     * TSCONFIG_REWRITE_WINDOW_MS sunt aruncate. `inject` = true când același
     * fișier a fost scris de ≥ 2 ori în fereastră (deci și peste chat-uri).
     * `now` e injectabil pentru teste.
     */
    record(path, now = Date.now()) {
        const key = tsconfigKey(path);
        if (!key)
            return { count: 0, inject: false };
        const recent = this.recent(key, now);
        recent.push(now);
        this.writes.set(key, recent);
        return { count: recent.length, inject: recent.length >= 2 };
    }
    /** Câte scrieri are fișierul în fereastra curentă (pentru log/decizii). */
    count(path, now = Date.now()) {
        const key = tsconfigKey(path);
        return key ? this.recent(key, now).length : 0;
    }
    /** Task nou (mesaj nou de user) ⇒ uită tot (inclusiv peste chat-uri). */
    reset() {
        this.writes.clear();
    }
    /** Timestamp-urile din fereastra care se termină la `now`. */
    recent(key, now) {
        const cutoff = now - exports.TSCONFIG_REWRITE_WINDOW_MS;
        return (this.writes.get(key) ?? []).filter((t) => t > cutoff);
    }
}
exports.TsconfigRewriteTracker = TsconfigRewriteTracker;
//# sourceMappingURL=circuitBreaker.js.map