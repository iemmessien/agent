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
exports.INDEX_VERSION = void 0;
exports.emptyIndex = emptyIndex;
exports.loadIndex = loadIndex;
exports.saveIndex = saveIndex;
exports.deleteIndex = deleteIndex;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
/* =========================================================================
 * v1.10.0 — VECTOR STORE LOCAL
 * Indexul semantic e un singur fișier JSON în globalStorage
 * (`<globalStorage>/semantic-index/<hash-workspace>.json`) — ZERO dependențe
 * npm noi. Scrierea e atomică (temp + rename) ca un index corupt să nu
 * rămână niciodată pe disc.
 * ========================================================================= */
exports.INDEX_VERSION = 1;
function emptyIndex(root, model) {
    const now = new Date().toISOString();
    return {
        version: exports.INDEX_VERSION,
        model,
        dim: 0,
        root,
        createdAt: now,
        updatedAt: now,
        files: {},
        chunks: []
    };
}
/** Citește indexul de pe disc; `null` dacă lipsește / e corupt / e altă versiune. */
async function loadIndex(file) {
    try {
        const raw = await fs.readFile(file, 'utf8');
        const data = JSON.parse(raw);
        if (!data || data.version !== exports.INDEX_VERSION)
            return null;
        if (!data.files || !Array.isArray(data.chunks))
            return null;
        return data;
    }
    catch {
        return null;
    }
}
/** Scrie indexul atomic (temp + rename), ca un crash să nu lase JSON trunchiat. */
async function saveIndex(file, data) {
    data.updatedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fs.rename(tmp, file);
}
/** Șterge indexul de pe disc. Întoarce true dacă exista ceva de șters. */
async function deleteIndex(file) {
    try {
        await fs.unlink(file);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=store.js.map