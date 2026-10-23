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
exports.DEFAULT_EMBED_MODEL = void 0;
exports.semanticConfig = semanticConfig;
exports.isSemanticEnabled = isSemanticEnabled;
exports.initIndexer = initIndexer;
exports.workspaceRoot = workspaceRoot;
exports.indexFilePath = indexFilePath;
exports.indexWorkspace = indexWorkspace;
exports.indexSingleFile = indexSingleFile;
exports.searchSemantic = searchSemantic;
exports.formatSearchResults = formatSearchResults;
exports.hasIndex = hasIndex;
exports.indexStatusText = indexStatusText;
exports.clearIndex = clearIndex;
exports.isOllamaUp = isOllamaUp;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const crypto = __importStar(require("crypto"));
const log_1 = require("../log");
const ollama_1 = require("../providers/ollama");
const embeddings_1 = require("./embeddings");
const store_1 = require("./store");
/* =========================================================================
 * v1.10.0 — INDEXARE SEMANTICĂ A WORKSPACE-ULUI
 * Scanează proiectul (cu excluderi inteligente), taie fișierele în chunk-uri
 * cu suprapunere, generează embeddings cu Ollama (`nomic-embed-text`) și le
 * păstrează într-un vector store JSON în globalStorage. Expune căutarea
 * semantică (`searchSemantic`) folosită de unealta `search_semantic`.
 * ========================================================================= */
const log = (msg) => (0, log_1.logLine)('indexer', msg);
/* ----------------------------- configurări ----------------------------- */
/** Directoare ignorate întotdeauna (build, dependențe, VCS, cache). */
const DEFAULT_EXCLUDE_DIRS = [
    'node_modules', '.git', '.hg', '.svn', 'out', 'dist', 'build', 'docs-build',
    '.next', '.nuxt', '.astro', '.svelte-kit', '.output', '.vercel', '.netlify',
    'coverage', '.nyc_output', '.cache', '.parcel-cache', '.turbo', '.gradle',
    '.idea', '.vscode-test', 'tmp', 'temp', 'bin', 'obj', 'target', 'vendor',
    '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache',
    'chrome-profile', 'node_modules.old', 'pkgs', '.terraform'
];
/** Fișiere ignorate după nume (lockfile-uri, artefacte). */
const SKIP_FILE_NAMES = new Set([
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
    'cargo.lock', 'poetry.lock', 'composer.lock', 'gemfile.lock', 'go.sum',
    'pipfile.lock', '.ds_store', 'thumbs.db'
]);
/** Extensii ignorate (binare / media / arhive / fonturi / build). */
const SKIP_EXTENSIONS = new Set([
    'vsix', 'map', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg',
    'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', 'tar', '7z', 'rar', 'exe', 'dll',
    'so', 'dylib', 'node', 'class', 'jar', 'war', 'bin', 'woff', 'woff2', 'ttf',
    'otf', 'eot', 'mp3', 'mp4', 'mov', 'avi', 'wav', 'ogg', 'flac', 'psd', 'ai',
    'db', 'sqlite', 'sqlite3', 'pyc', 'pyo', 'o', 'a', 'obj', 'pdb', 'wasm',
    'iso', 'img', 'ttc'
]);
const CHUNK_LINES = 60;
const OVERLAP_LINES = 12;
const MAX_LINE_LENGTH = 5000;
const MAX_STORED_CHARS = 8000;
/** Modelul implicit de embeddings (local, instalabil cu `ollama pull`). */
exports.DEFAULT_EMBED_MODEL = 'nomic-embed-text';
/** Setările `freekit.semanticIndex.*` (citite live, la fiecare apel). */
function semanticConfig() {
    const cfg = vscode.workspace.getConfiguration('freekit');
    const rawMax = Number(cfg.get('semanticIndex.maxFileKb', 256));
    const rawTop = Number(cfg.get('semanticIndex.topK', 8));
    const extra = cfg.get('semanticIndex.exclude', []) || [];
    return {
        enabled: cfg.get('semanticIndex.enabled', true) === true,
        model: String(cfg.get('semanticIndex.model', exports.DEFAULT_EMBED_MODEL) || '').trim() ||
            exports.DEFAULT_EMBED_MODEL,
        onSave: cfg.get('semanticIndex.onSave', false) === true,
        maxFileKb: Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 256,
        topK: Number.isFinite(rawTop) && rawTop > 0 ? Math.floor(rawTop) : 8,
        extraExclude: extra.map((s) => String(s).trim()).filter(Boolean)
    };
}
/** true doar dacă unealta search_semantic e activată din setări. */
function isSemanticEnabled() {
    return semanticConfig().enabled;
}
/* ------------------------------- căi ----------------------------------- */
let storageDir = '';
/** Inițializat o dată la activarea extensiei (în extension.ts). */
function initIndexer(globalStorageRoot) {
    storageDir = path.join(globalStorageRoot, 'semantic-index');
    log('storage dir: ' + storageDir);
}
/** Rădăcina primului workspace deschis (null dacă nu există folder). */
function workspaceRoot() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || !folders.length)
        return null;
    return folders[0].uri.fsPath;
}
/** Fișierul de index al unui workspace (nume derivat din calea rădăcină). */
function indexFilePath(root) {
    const hash = crypto.createHash('sha1').update(root).digest('hex').slice(0, 16);
    const base = path.basename(root).replace(/[^a-z0-9._-]/gi, '_') || 'workspace';
    return path.join(storageDir, base + '-' + hash + '.json');
}
/* ------------------------- cache în memorie ---------------------------- */
let cache = null;
/** Încarcă indexul, cu cache invalidat de mtime (căutările repetate nu re-citesc JSON-ul). */
async function cachedLoad(root) {
    const file = indexFilePath(root);
    let mtimeMs = 0;
    try {
        mtimeMs = (await fs.stat(file)).mtimeMs;
    }
    catch {
        cache = null;
        return null;
    }
    if (cache && cache.file === file && cache.mtimeMs === mtimeMs)
        return cache.data;
    const data = await (0, store_1.loadIndex)(file);
    if (data)
        cache = { file, mtimeMs, data };
    else
        cache = null;
    return data;
}
async function walk(dir, root, exclude, out) {
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const e of entries) {
        const abs = path.join(dir, e.name);
        if (e.isSymbolicLink())
            continue;
        if (e.isDirectory()) {
            if (exclude.has(e.name.toLowerCase()))
                continue;
            await walk(abs, root, exclude, out);
            continue;
        }
        if (!e.isFile())
            continue;
        const lower = e.name.toLowerCase();
        if (SKIP_FILE_NAMES.has(lower))
            continue;
        if (lower.includes('.min.') || lower.endsWith('.d.ts'))
            continue;
        const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
        if (SKIP_EXTENSIONS.has(ext))
            continue;
        let st;
        try {
            st = await fs.stat(abs);
        }
        catch {
            continue;
        }
        if (!st.size)
            continue;
        out.push({
            abs,
            rel: path.relative(root, abs).split(path.sep).join('/'),
            size: st.size,
            mtimeMs: st.mtimeMs
        });
    }
}
function sha1(text) {
    return crypto.createHash('sha1').update(text).digest('hex');
}
/** true când conținutul pare binar (NUL în primii 8 KB). */
function looksBinary(buf) {
    const n = Math.min(buf.length, 8192);
    for (let i = 0; i < n; i++)
        if (buf[i] === 0)
            return true;
    return false;
}
/** Taie conținutul în chunk-uri de linii cu suprapunere (overlap). */
function chunkText(content) {
    const lines = content.split(/\r?\n/);
    const out = [];
    const step = Math.max(1, CHUNK_LINES - OVERLAP_LINES);
    for (let i = 0; i < lines.length; i += step) {
        const end = Math.min(lines.length, i + CHUNK_LINES);
        const text = lines.slice(i, end).join('\n').trim();
        if (text)
            out.push({ start: i + 1, end, text: text.slice(0, MAX_STORED_CHARS) });
        if (end >= lines.length)
            break;
    }
    return out;
}
/* ------------------------------- indexare ------------------------------ */
/**
 * Indexează (sau actualizează incremental) workspace-ul. Fișierele al căror
 * conținut nu s-a schimbat își păstrează vectorii existenți — doar fișierele
 * noi/modificate sunt re-embeduite. La final indexul e scris pe disc.
 */
async function indexWorkspace(root, opts = {}) {
    const started = Date.now();
    const cfg = semanticConfig();
    const stats = {
        files: 0,
        indexed: 0,
        unchanged: 0,
        removed: 0,
        chunks: 0,
        failed: 0,
        skipped: 0,
        cancelled: false,
        durationMs: 0
    };
    const exclude = new Set(DEFAULT_EXCLUDE_DIRS.map((d) => d.toLowerCase()));
    for (const e of cfg.extraExclude)
        exclude.add(e.toLowerCase());
    const candidates = [];
    await walk(root, root, exclude, candidates);
    stats.files = candidates.length;
    log('index: ' + candidates.length + ' candidate files under ' + root);
    const loaded = await cachedLoad(root);
    // Indexul e refolosit doar dacă modelul de embeddings e același.
    const base = loaded && loaded.model === cfg.model ? loaded : (0, store_1.emptyIndex)(root, cfg.model);
    if (loaded && loaded.model !== cfg.model) {
        log('index: model changed (' + loaded.model + ' -> ' + cfg.model + '), full re-index');
    }
    const stillPresent = new Set(candidates.map((c) => c.rel));
    const chunksByPath = new Map();
    for (const ch of base.chunks) {
        if (!stillPresent.has(ch.path))
            continue;
        const arr = chunksByPath.get(ch.path);
        if (arr)
            arr.push(ch);
        else
            chunksByPath.set(ch.path, [ch]);
    }
    stats.removed = Object.keys(base.files).filter((p) => !stillPresent.has(p)).length;
    const maxBytes = cfg.maxFileKb * 1024;
    const files = {};
    let done = 0;
    for (const cand of candidates) {
        if (opts.signal?.aborted) {
            stats.cancelled = true;
            break;
        }
        done++;
        opts.onProgress?.({ done, total: candidates.length, file: cand.rel });
        const prev = base.files[cand.rel];
        // un fișier sărit nu mai e indexat — vectorii vechi sunt eliminați
        const skipFile = (reason, size = cand.size, mtimeMs = cand.mtimeMs) => {
            stats.skipped++;
            chunksByPath.delete(cand.rel);
            files[cand.rel] = { hash: '', size, mtimeMs, chunks: 0, skipped: reason };
        };
        if (cand.size > maxBytes) {
            skipFile('too large');
            continue;
        }
        let buf;
        try {
            buf = await fs.readFile(cand.abs);
        }
        catch {
            skipFile('unreadable');
            continue;
        }
        if (looksBinary(buf)) {
            skipFile('binary');
            continue;
        }
        const content = buf.toString('utf8');
        const longest = content.length ? Math.max(...content.split('\n', 200).map((l) => l.length)) : 0;
        if (longest > MAX_LINE_LENGTH) {
            skipFile('minified / very long lines');
            continue;
        }
        const hash = sha1(content);
        // Incremental: hash identic ȘI model identic => vectorii se păstrează.
        if (!opts.force && prev && prev.hash === hash && chunksByPath.has(cand.rel)) {
            stats.unchanged++;
            files[cand.rel] = {
                hash,
                size: cand.size,
                mtimeMs: cand.mtimeMs,
                chunks: chunksByPath.get(cand.rel).length
            };
            continue;
        }
        const raw = chunkText(content);
        const chunks = [];
        let failed = 0;
        for (const rc of raw) {
            if (opts.signal?.aborted) {
                stats.cancelled = true;
                break;
            }
            const vector = await (0, embeddings_1.embedText)(cand.rel + '\n' + rc.text, {
                ollamaUrl: (0, ollama_1.ollamaBaseUrl)(),
                model: cfg.model
            });
            if (!vector) {
                failed++;
                continue;
            }
            chunks.push({ path: cand.rel, start: rc.start, end: rc.end, text: rc.text, vector });
        }
        if (stats.cancelled) {
            // păstrăm vectorii vechi (dacă există) ca indexul parțial să rămână valid
            if (chunksByPath.has(cand.rel))
                files[cand.rel] = { ...prev };
            break;
        }
        if (failed)
            stats.failed += failed;
        chunksByPath.set(cand.rel, chunks);
        stats.indexed++;
        files[cand.rel] = {
            hash,
            size: cand.size,
            mtimeMs: cand.mtimeMs,
            chunks: chunks.length,
            ...(failed && !chunks.length ? { skipped: 'embedding failed' } : {})
        };
    }
    const chunks = [];
    for (const arr of chunksByPath.values())
        chunks.push(...arr);
    const data = {
        ...base,
        model: cfg.model,
        dim: chunks.length ? chunks[0].vector.length : base.dim,
        files,
        chunks
    };
    // păstrăm și fișierele sărite (prea mari/binare) pentru statistici corecte
    for (const [p, f] of Object.entries(base.files)) {
        if (!files[p] && stillPresent.has(p))
            files[p] = f;
    }
    data.files = files;
    await (0, store_1.saveIndex)(indexFilePath(root), data);
    cache = null;
    stats.chunks = chunks.length;
    stats.durationMs = Date.now() - started;
    log('index done: ' +
        stats.indexed +
        ' indexed, ' +
        stats.unchanged +
        ' unchanged, ' +
        stats.removed +
        ' removed, ' +
        chunks.length +
        ' chunks' +
        (stats.cancelled ? ' (cancelled)' : '') +
        ' in ' +
        stats.durationMs +
        'ms');
    return stats;
}
/** Indexare incrementală a unui singur fișier (la salvare). */
async function indexSingleFile(root, absPath) {
    const cfg = semanticConfig();
    if (!cfg.enabled)
        return 'skipped';
    const data = await cachedLoad(root);
    if (!data)
        return 'no-index';
    const rel = path.relative(root, absPath).split(path.sep).join('/');
    if (!rel || rel.startsWith('..'))
        return 'skipped';
    const lowerName = path.basename(absPath).toLowerCase();
    const ext = lowerName.includes('.') ? lowerName.slice(lowerName.lastIndexOf('.') + 1) : '';
    if (SKIP_FILE_NAMES.has(lowerName) ||
        SKIP_EXTENSIONS.has(ext) ||
        lowerName.includes('.min.')) {
        return 'skipped';
    }
    let buf;
    try {
        buf = await fs.readFile(absPath);
    }
    catch {
        return 'skipped';
    }
    if (!buf.length || buf.length > cfg.maxFileKb * 1024 || looksBinary(buf))
        return 'skipped';
    const content = buf.toString('utf8');
    const longest = Math.max(...content.split('\n', 200).map((l) => l.length));
    if (longest > MAX_LINE_LENGTH)
        return 'skipped';
    const hash = sha1(content);
    if (data.files[rel]?.hash === hash && data.chunks.some((c) => c.path === rel)) {
        return 'unchanged';
    }
    const chunks = [];
    for (const rc of chunkText(content)) {
        const vector = await (0, embeddings_1.embedText)(rel + '\n' + rc.text, {
            ollamaUrl: (0, ollama_1.ollamaBaseUrl)(),
            model: cfg.model
        });
        if (vector)
            chunks.push({ path: rel, start: rc.start, end: rc.end, text: rc.text, vector });
    }
    const kept = data.chunks.filter((c) => c.path !== rel);
    data.chunks = kept.concat(chunks);
    data.files[rel] = { hash, size: buf.length, mtimeMs: Date.now(), chunks: chunks.length };
    data.dim = data.chunks.length ? data.chunks[0].vector.length : data.dim;
    await (0, store_1.saveIndex)(indexFilePath(root), data);
    cache = null;
    log('incremental: ' + rel + ' -> ' + chunks.length + ' chunks');
    return 'updated';
}
function makeSnippet(text) {
    const lines = text.split('\n');
    const body = lines.length > 40 ? lines.slice(0, 40).join('\n') + '\n…' : text;
    return body.length > 1600 ? body.slice(0, 1600) + '…' : body;
}
/** Caută cele mai relevante chunk-uri pentru un text (query în limbaj natural). */
async function searchSemantic(root, query, limit) {
    const cfg = semanticConfig();
    if (!cfg.enabled) {
        return { hits: [], error: 'Semantic search is disabled (freekit.semanticIndex.enabled).' };
    }
    const q = String(query ?? '').trim();
    if (!q)
        return { hits: [], error: 'Empty query.' };
    const data = await cachedLoad(root);
    if (!data || !data.chunks.length) {
        return {
            hits: [],
            error: 'No semantic index found for this workspace. Run the command "Freekit: Index Workspace" first.'
        };
    }
    if (data.model !== cfg.model) {
        return {
            hits: [],
            error: 'The index was built with a different embedding model (' +
                data.model +
                '). Re-run "Freekit: Index Workspace".'
        };
    }
    const qvec = await (0, embeddings_1.embedText)(q, { ollamaUrl: (0, ollama_1.ollamaBaseUrl)(), model: cfg.model });
    if (!qvec) {
        return {
            hits: [],
            error: 'Could not compute the query embedding — is Ollama running (' + (0, ollama_1.ollamaBaseUrl)() + ')?'
        };
    }
    const k = Math.min(Math.max(1, limit ?? cfg.topK), 25);
    const scored = data.chunks
        .map((c) => ({ chunk: c, score: (0, embeddings_1.cosineSimilarity)(qvec, c.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    return {
        hits: scored.map((s) => ({
            path: s.chunk.path,
            start: s.chunk.start,
            end: s.chunk.end,
            score: s.score,
            snippet: makeSnippet(s.chunk.text)
        })),
        model: data.model,
        totalChunks: data.chunks.length
    };
}
/** Text pregătit pentru AI / notificări: rezultatele căutării semantice. */
async function formatSearchResults(root, query, limit) {
    const r = await searchSemantic(root, query, limit);
    if (r.error)
        return 'Semantic search error: ' + r.error;
    if (!r.hits.length)
        return 'No semantic matches for: ' + query;
    const lines = [
        'Semantic matches for "' +
            query +
            '" (' +
            r.hits.length +
            ' of ' +
            r.totalChunks +
            ' chunks, model: ' +
            r.model +
            '):'
    ];
    r.hits.forEach((h, i) => {
        lines.push('\n' +
            (i + 1) +
            '. ' +
            h.path +
            ':' +
            h.start +
            '-' +
            h.end +
            '  (score ' +
            h.score.toFixed(3) +
            ')\n' +
            h.snippet);
    });
    return lines.join('\n');
}
/* ------------------------------ status / clear ------------------------- */
/** true dacă există un index pentru workspace. */
async function hasIndex(root) {
    const data = await cachedLoad(root);
    return !!data && data.chunks.length > 0;
}
/** Rezumatul indexului (folosit de comanda „Index Status” și de AI). */
async function indexStatusText(root) {
    const cfg = semanticConfig();
    const file = indexFilePath(root);
    const data = await (0, store_1.loadIndex)(file);
    if (!data) {
        return ('No semantic index for this workspace.\n' +
            'Root: ' +
            root +
            '\nModel: ' +
            cfg.model +
            '\nRun "Freekit: Index Workspace" to build it.');
    }
    const indexedFiles = Object.values(data.files).filter((f) => f.chunks > 0).length;
    const skipped = Object.values(data.files).filter((f) => f.skipped).length;
    const sizeKb = await fs
        .stat(file)
        .then((s) => Math.round(s.size / 1024))
        .catch(() => 0);
    return ('Semantic index status\n' +
        'Root: ' +
        root +
        '\nModel: ' +
        data.model +
        ' (dim ' +
        data.dim +
        ')' +
        '\nFiles indexed: ' +
        indexedFiles +
        ' (skipped: ' +
        skipped +
        ')' +
        '\nChunks: ' +
        data.chunks.length +
        '\nIndex file: ' +
        file +
        ' (' +
        sizeKb +
        ' KB)' +
        '\nCreated: ' +
        data.createdAt +
        '\nUpdated: ' +
        data.updatedAt +
        '\nAuto-index on save: ' +
        (cfg.onSave ? 'ON' : 'OFF'));
}
/** Șterge indexul workspace-ului curent (comanda „Clear Index”). */
async function clearIndex(root) {
    cache = null;
    const removed = await (0, store_1.deleteIndex)(indexFilePath(root));
    log('index cleared for ' + root + ': ' + removed);
    return removed;
}
/** true dacă Ollama răspunde (pentru mesaje de eroare clare în comenzi). */
async function isOllamaUp() {
    return (0, embeddings_1.ollamaAvailable)((0, ollama_1.ollamaBaseUrl)());
}
//# sourceMappingURL=indexer.js.map