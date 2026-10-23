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
exports.newAttachmentId = newAttachmentId;
exports.classifyPath = classifyPath;
exports.describePath = describePath;
exports.prepareAttachments = prepareAttachments;
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const log_1 = require("./log");
const payload_1 = require("./payload");
const log = (msg) => (0, log_1.logLine)('attachments', msg);
const IMAGE_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif', '.tiff'
]);
const TEXT_EXTS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc',
    '.md', '.mdx', '.txt', '.css', '.scss', '.less', '.html', '.htm',
    '.astro', '.vue', '.svelte', '.py', '.rb', '.php', '.go', '.rs',
    '.java', '.kt', '.kts', '.cs', '.c', '.h', '.cpp', '.hpp', '.cc',
    '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
    '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.env',
    '.sql', '.graphql', '.gql', '.xml', '.csv', '.log', '.diff', '.patch'
]);
const TEXT_NAMES = new Set([
    'dockerfile', 'makefile', '.gitignore', '.gitattributes', '.editorconfig',
    '.npmrc', '.prettierrc', '.eslintrc', '.babelrc', 'license', 'readme',
    'procfile', 'rakefile', 'gemfile'
]);
function newAttachmentId() {
    return Math.random().toString(36).slice(2, 10);
}
function classifyPath(name, isDir) {
    if (isDir)
        return 'folder';
    const ext = path.extname(name).toLowerCase();
    if (IMAGE_EXTS.has(ext))
        return 'image';
    if (TEXT_EXTS.has(ext))
        return 'text';
    const base = path.basename(name).toLowerCase();
    if (TEXT_NAMES.has(base) || (base.startsWith('.') && !ext))
        return 'text';
    return 'binary';
}
/** Citește metadatele unui path. Returnează null dacă nu există/e inaccesibil. */
async function describePath(absPath, root) {
    try {
        const st = await fs.stat(absPath);
        const isDir = st.isDirectory();
        const rel = root ? path.relative(root, absPath) : '';
        const inside = !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
        return {
            id: newAttachmentId(),
            name: path.basename(absPath) || absPath,
            relPath: inside ? rel : absPath,
            absPath,
            kind: classifyPath(absPath, isDir),
            size: isDir ? 0 : st.size
        };
    }
    catch (e) {
        log('describePath eșuat: ' + absPath + ' — ' + (e?.message ?? String(e)));
        return null;
    }
}
/* =========================================================================
 * Pregătirea conținutului pentru mesajul trimis AI-ului
 * ========================================================================= */
/* v2.5.23 (bug #54): bugetul de atașamente era 30k/fișier și 150k total — un
 * paste uriaș procesat minute întregi de web app. Aliniat la bugetul comun
 * (6000/fișier, 12000 total), cu trunchiere cap+coadă. */
const MAX_PER_FILE = payload_1.MAX_CHARS_PER_FILE;
const MAX_TOTAL = payload_1.MAX_CHARS_TOTAL;
/** Sub acest rest de buget nu mai are sens să includem conținut — marcăm SKIPPED. */
const MIN_PER_FILE = 1500;
const SKIPPED_NOTE = '[SKIPPED: payload limit reached]';
const FOLDER_MAX_ENTRIES = 200;
const FOLDER_EXCLUDE = new Set([
    'node_modules', '.git', 'out', 'dist', 'build', '.next', '.cache',
    'coverage', 'chrome-profile', '.vscode', '__pycache__', 'target', '.idea'
]);
async function prepareAttachments(root, atts) {
    const parts = [];
    const uploads = [];
    let used = 0;
    /** Restul de buget disponibil (niciodată negativ). */
    const remaining = () => Math.max(0, MAX_TOTAL - used);
    for (const a of atts) {
        try {
            if (a.kind === 'folder') {
                const listing = await folderTree(a.absPath);
                if (remaining() < MIN_PER_FILE) {
                    parts.push('--- FOLDER: ' + a.relPath + '/ ---\n' + SKIPPED_NOTE);
                    continue;
                }
                const chunk = (0, payload_1.clipPayload)('--- FOLDER: ' + a.relPath + '/ ---\n' + listing +
                    '\n(listing folder — folosește read_file / read_files pentru conținut)', Math.min(MAX_PER_FILE, remaining()));
                used += chunk.length;
                parts.push(chunk);
            }
            else if (a.kind === 'text') {
                const content = await readTextSafe(a.absPath);
                if (content === null) {
                    uploads.push(a.absPath);
                    parts.push('--- FILE: ' + a.relPath + ' ---\n' +
                        '(fișier netextual — încărcat ca atașament în chatul web)');
                    continue;
                }
                if (remaining() < MIN_PER_FILE) {
                    parts.push('--- FILE: ' + a.relPath + ' ---\n' + SKIPPED_NOTE);
                    continue;
                }
                const clipped = (0, payload_1.truncateContent)(content, payload_1.MAX_LINES_PER_FILE, Math.min(MAX_PER_FILE, remaining()));
                const chunk = '--- FILE: ' + a.relPath + ' (' + content.length + ' bytes) ---\n' +
                    '```' + langFor(a.relPath) + '\n' + clipped + '\n```';
                used += chunk.length;
                parts.push(chunk);
            }
            else {
                // image / binary → upload real în chatul web
                uploads.push(a.absPath);
                parts.push('--- ATTACHED FILE: ' + a.relPath + ' ---\n' +
                    '(fișier încărcat în chatul web ca atașament)');
            }
        }
        catch (e) {
            parts.push('--- FILE: ' + a.relPath + ' ---\n(eroare la citire: ' +
                (e?.message ?? String(e)) + ')');
        }
    }
    // plasă de siguranță: chiar dacă un element a depășit bugetul (ex. antetul
    // lung al unui fișier), blocul final rămâne în buget (cap+coadă).
    return { block: (0, payload_1.clipPayload)(parts.join('\n\n'), MAX_TOTAL), uploads };
}
async function readTextSafe(abs) {
    const buf = await fs.readFile(abs);
    const probe = buf.subarray(0, Math.min(buf.length, 4096));
    if (probe.includes(0))
        return null; // conține NUL → binar
    return buf.toString('utf8');
}
async function folderTree(absDir) {
    const lines = [];
    let count = 0;
    async function walk(dir, depth, prefix) {
        if (depth > 4 || count >= FOLDER_MAX_ENTRIES)
            return;
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        const visible = entries
            .filter((e) => !(e.isDirectory() && FOLDER_EXCLUDE.has(e.name)))
            .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory())
                return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        for (let i = 0; i < visible.length; i++) {
            if (count >= FOLDER_MAX_ENTRIES) {
                lines.push(prefix + '... (trunchiat la ' + FOLDER_MAX_ENTRIES + ' intrări)');
                return;
            }
            const e = visible[i];
            const isLast = i === visible.length - 1;
            lines.push(prefix + (isLast ? '└── ' : '├── ') + e.name + (e.isDirectory() ? '/' : ''));
            count++;
            if (e.isDirectory()) {
                await walk(path.join(dir, e.name), depth + 1, prefix + (isLast ? '    ' : '│   '));
            }
        }
    }
    await walk(absDir, 1, '');
    return lines.join('\n') || '(folder gol)';
}
const LANG_MAP = {
    '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.jsx': 'jsx', '.mjs': 'js',
    '.cjs': 'js', '.json': 'json', '.md': 'md', '.mdx': 'md', '.css': 'css',
    '.scss': 'scss', '.html': 'html', '.astro': 'astro', '.vue': 'vue',
    '.svelte': 'svelte', '.py': 'python', '.rb': 'ruby', '.php': 'php',
    '.go': 'go', '.rs': 'rust', '.java': 'java', '.cs': 'csharp',
    '.sh': 'bash', '.ps1': 'powershell', '.yml': 'yaml', '.yaml': 'yaml',
    '.toml': 'toml', '.sql': 'sql', '.xml': 'xml'
};
function langFor(p) {
    return LANG_MAP[path.extname(p).toLowerCase()] || '';
}
//# sourceMappingURL=attachments.js.map