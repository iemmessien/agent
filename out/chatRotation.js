"use strict";
/* =========================================================================
 * v2.5.25 (bug #62) — HANDOFF-UL DE ROTIRE PĂSTREAZĂ FIȘIERELE CITITE
 *
 * Rotirea proactivă a chatului web (v2.5.23) deschide un chat NOU, complet gol:
 * acolo NU ajung rezultatele uneltelor (fișierele citite rămân în chatul vechi).
 * Handoff-ul ducea doar rezumatul task-ului + pașii făcuți, așa că AI-ul din
 * chatul nou cerea re-citirea fișierelor („trimite batch-ul").
 *
 * Aici stau bucățile pure (fără `vscode`), ca logica să fie ușor de verificat:
 *   - isReadEverythingTask() — „citește TOATE fișierele și rezumă" (un astfel de
 *     task oricum nu încape într-un chat: rotirea l-ar obliga pe cel nou să
 *     re-citească tot → nu rotim, lăsăm „Chat memory full" să decidă);
 *   - recordReadFiles() / invalidateTouchedFiles() — ce fișiere a văzut chatul;
 *   - formatReadFilesList() / formatReadFilesExcerpts() — ce primește chatul nou.
 * ========================================================================= */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isReadEverythingTask = isReadEverythingTask;
exports.extractReadFiles = extractReadFiles;
exports.recordReadFiles = recordReadFiles;
exports.extractTouchedFiles = extractTouchedFiles;
exports.extractWrittenFiles = extractWrittenFiles;
exports.invalidateTouchedFiles = invalidateTouchedFiles;
exports.formatReadFilesList = formatReadFilesList;
exports.formatReadFilesExcerpts = formatReadFilesExcerpts;
const tsAlias_1 = require("./tsAlias");
/** câte fișiere ținem minte per chat de browser (handoff-ul rămâne mărginit) */
const MAX_TRACKED_FILES = 120;
/**
 * v2.5.48: cât conținut păstrăm per fișier. Sub pragul `FULL_FILE_CHARS` fișierul
 * e dus COMPLET în handoff (nu mai e trunchiat la 500 de caractere).
 */
const MAX_TRACKED_CHARS = 20000;
/** sub atâția caractere fișierul intră COMPLET în handoff */
const FULL_FILE_CHARS = 8000;
/** peste prag: head + tail de atâția caracteri fiecare (8000 per fișier) */
const HEAD_TAIL_CHARS = 4000;
/** câte căi intră în lista „Already read: …" */
const MAX_LISTED_PATHS = 60;
/** lungimea maximă a listei inline de căi (cap pentru chatul nou) */
const MAX_PATH_LIST_CHARS = 1200;
/**
 * v2.5.48: bugetul total al extraselor de conținut. Mult mai generos decât
 * înainte (2000), ca handoff-ul să nu mai piardă fișierele citite — dar tot
 * mărginit, ca paste-ul de la rotire să nu umple singur contextul chatului
 * nou. Fișierele rămase sunt oricum listate în „Already read: …".
 */
const MAX_EXCERPT_TOTAL = 32000;
/** sub atât nu mai are sens să începem un extras nou */
const MIN_EXCERPT_BUDGET = 200;
/**
 * v2.5.25 (bug #62): task care citește MULTE fișiere și le rezumă/analizează
 * („read every .ts file in src/ and summarize", „read all files and explain",
 * „summarize the whole codebase"). Un astfel de task nu încape oricum într-un
 * singur chat web (fiecare citire e un paste mare), iar rotirea NU ajută:
 * chatul nou ar porni fără rezultate și ar cere re-citirea tuturor fișierelor.
 * Nu rotim pentru el — „Chat memory full" (care are card + handoff) decide.
 */
function isReadEverythingTask(text) {
    const t = String(text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!t)
        return false;
    const verb = /\b(read|reading|review|scan|analy[sz]e|inspect|summari[sz]e|summarise|document|audit|map|walk|understand|explain|list|go\s+through)\b/i;
    const all = /\b(all|every|each|entire|whole|full)\b/i;
    const target = /\b(files?|sources?|modules?|components?|classes?|functions?|codebase|project|repo|repository|workspace|folder|directory|src)\b|\.(ts|tsx|js|jsx|mjs|cjs|py|go|cs|java|rb|php|rs|kt|swift|vue|svelte)\b/i;
    return verb.test(t) && all.test(t) && target.test(t);
}
/** Fișierele ale căror conținut a ajuns la AI într-un rezultat de unealtă. */
function extractReadFiles(call, result) {
    if (!result.ok)
        return [];
    const out = String(result.result ?? '');
    if (!out)
        return [];
    const args = call.args ?? {};
    if (call.tool === 'read_file') {
        const p = typeof args.path === 'string' ? args.path : '';
        return p ? [[p, out]] : [];
    }
    if (call.tool !== 'read_files')
        return [];
    // read_files lipește secțiuni „--- FILE: <path> ---\n<conținut>"
    const files = [];
    for (const part of out.split(/^--- FILE: /m).slice(1)) {
        const sep = part.indexOf(' ---');
        if (sep <= 0)
            continue;
        // v2.5.27 (bug #63): antetul poate purta aliasul `.ts.txt` trimis AI-ului —
        // în mapă ținem calea reală (`.ts`), ca invalidarea după scriere să nimerească
        const p = (0, tsAlias_1.stripTsAliasPath)(part.slice(0, sep).trim());
        const body = part.slice(sep + 4).trim();
        // fișierele SĂRITE (buget de payload) sau eronate NU au ajuns la AI
        if (!p || body.startsWith('[SKIPPED:') || body.startsWith('(error:'))
            continue;
        files.push([p, body]);
    }
    return files;
}
/** Reține fișierele citite (cele mai noi înlocuiesc versiunea veche). */
function recordReadFiles(files, call, result) {
    for (const [p, content] of extractReadFiles(call, result)) {
        if (!files.has(p) && files.size >= MAX_TRACKED_FILES)
            continue;
        files.set(p, content.length > MAX_TRACKED_CHARS
            ? content.slice(0, MAX_TRACKED_CHARS)
            : content);
    }
}
/** Fișierele atinse de o scriere/ștergere — extrasul lor devine învechit. */
function extractTouchedFiles(call) {
    const args = call.args ?? {};
    // v2.5.50 FIX 3: copy_file scrie la destinație (`to`), nu la `args.path`
    if (call.tool === 'copy_file') {
        return typeof args.to === 'string' && args.to ? [args.to] : [];
    }
    if (call.tool === 'write_file' ||
        call.tool === 'edit_file' ||
        // v2.5.42 (bug #98): și fișierele șterse ies din handoff
        call.tool === 'delete_file' ||
        call.tool === 'delete_directory') {
        return typeof args.path === 'string' && args.path ? [args.path] : [];
    }
    if (call.tool === 'write_files' && Array.isArray(args.files)) {
        return args.files
            .map((f) => (typeof f?.path === 'string' ? f.path : ''))
            .filter((p) => !!p);
    }
    return [];
}
/**
 * v2.5.50: fișierele CREATE/MODIFICATE de o unealtă de scriere (fără ștergeri).
 * Handoff-ul le enumeră explicit, ca modelul din chatul nou (sau de pe alt
 * provider) să știe ce s-a produs deja și să nu rescrie fișierele de la zero.
 */
function extractWrittenFiles(call) {
    if (call.tool === 'delete_file' || call.tool === 'delete_directory')
        return [];
    return extractTouchedFiles(call);
}
/** Scoate din handoff fișierele modificate (conținutul citit e depășit). */
function invalidateTouchedFiles(files, call) {
    for (const p of extractTouchedFiles(call)) {
        files.delete(p);
        // v2.5.42 (bug #98): un folder șters duce cu el tot ce era sub el
        if (call.tool === 'delete_directory') {
            const prefix = p.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
            for (const key of [...files.keys()]) {
                if (key.replace(/\\/g, '/').startsWith(prefix))
                    files.delete(key);
            }
        }
    }
}
/**
 * Lista inline „Already read: …" — intră în corpul handoff-ului (deci
 * supraviețuiește trunchierii lui), ca modelul să nu ceară re-citirea.
 * v2.5.27 (bug #63): căile TS apar cu aliasul `.ts.txt` (cum le-a văzut AI-ul).
 */
function formatReadFilesList(files) {
    if (!files.size)
        return '';
    const shown = [];
    let chars = 0;
    for (const p of files.keys()) {
        const aiPath = (0, tsAlias_1.toAiPath)(p);
        if (shown.length >= MAX_LISTED_PATHS)
            break;
        if (chars + aiPath.length > MAX_PATH_LIST_CHARS)
            break;
        shown.push(aiPath);
        chars += aiPath.length + 2;
    }
    if (!shown.length)
        return '';
    const rest = files.size - shown.length;
    return ('Already read in this task — do NOT re-read these files: ' +
        shown.join(', ') +
        (rest > 0 ? ', … (+' + rest + ' more)' : '') +
        '.');
}
/**
 * v2.5.48 — conținutul unui fișier pentru handoff: sub 8k caractere trimite
 * fișierul COMPLET (nu mai pierdem context), peste trimite începutul + sfârșitul
 * de câte 4000 de caractere (head + tail, nu doar capul).
 */
function handoffBody(text) {
    const t = String(text ?? '').replace(/\r\n/g, '\n').trim();
    if (!t)
        return '';
    if (t.length <= FULL_FILE_CHARS)
        return t;
    const marker = '\n…\n';
    return t.slice(0, HEAD_TAIL_CHARS) + marker + t.slice(-HEAD_TAIL_CHARS);
}
/**
 * Conținutul fișierelor citite — așa chatul nou primește chiar conținutul, nu
 * doar numele fișierelor.
 * v2.5.48: NU se mai trunchiază agresiv — fișierele sub 8k caractere merg
 * COMPLET, cele peste merg head+tail de 4000 de caractere fiecare. Bugetul
 * total rămâne doar o plasă de siguranță pentru paste-uri patologice.
 * v2.5.27 (bug #63): fișierele TS se trimit și aici ca `.ts.txt` (+ notă).
 */
function formatReadFilesExcerpts(files, maxTotal = MAX_EXCERPT_TOTAL) {
    if (!files.size)
        return '';
    const parts = [];
    let budget = maxTotal;
    let skipped = 0;
    for (const [p, content] of files) {
        if (budget < MIN_EXCERPT_BUDGET) {
            skipped++;
            continue;
        }
        // <8k → complet; >8k → head+tail 4000+4000 (regula din handoffBody)
        const body = handoffBody(content);
        if (!body)
            continue;
        const aiPath = (0, tsAlias_1.toAiPath)(p);
        const block = '--- FILE: ' + aiPath + ' ---' +
            (aiPath === p ? '' : '\n' + tsAlias_1.TS_ALIAS_NOTE) +
            '\n' + body;
        parts.push(block);
        budget -= block.length;
    }
    if (!parts.length)
        return '';
    return ('Excerpts (content as read in the previous chat) of the files already read:' +
        (skipped
            ? '\n(' + skipped + ' smaller excerpt(s) omitted for size; re-read them only if needed.)'
            : '') +
        '\n' +
        parts.join('\n\n'));
}
//# sourceMappingURL=chatRotation.js.map