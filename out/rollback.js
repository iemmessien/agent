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
exports.EditRollback = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const log_1 = require("./log");
const log = (msg) => (0, log_1.logLine)('rollback', msg);
class EditRollback {
    /** Starea dinainte de prima atingere a fiecărui fișier (per mesaj). */
    initial = new Map();
    /** Starea fiecărui fișier la ultima verificare TRECUTĂ (checkpoint). */
    good = new Map();
    static key(abs) {
        return path.normalize(abs).toLowerCase();
    }
    /** Golește tot (se apelează la începutul fiecărui mesaj). */
    reset() {
        this.initial.clear();
        this.good.clear();
    }
    /** Câte fișiere sunt urmărite în mesajul curent. */
    get size() {
        return this.initial.size;
    }
    hasSnapshots() {
        return this.initial.size > 0;
    }
    /**
     * Salvează starea dinainte de prima atingere a fiecărui fișier
     * (fișierele deja urmărite în acest mesaj sunt ignorate).
     */
    snapshot(absPaths) {
        for (const abs of absPaths) {
            const key = EditRollback.key(abs);
            if (this.initial.has(key))
                continue;
            try {
                if (!fs.existsSync(abs)) {
                    this.initial.set(key, { abs, existed: false, content: '' });
                    continue;
                }
                if (fs.statSync(abs).isDirectory()) {
                    log('snapshot: sar peste directorul ' + abs);
                    continue;
                }
                this.initial.set(key, {
                    abs,
                    existed: true,
                    content: fs.readFileSync(abs, 'utf8')
                });
            }
            catch (e) {
                log('snapshot eșuat pentru ' + abs + ': ' + (e?.message ?? String(e)));
            }
        }
    }
    /**
     * După o verificare TRECUTĂ: starea actuală de pe disc a tuturor fișierelor
     * urmărite devine „ultima stare bună” (ținta rollback-ului).
     */
    markGood() {
        for (const [key, entry] of this.initial) {
            try {
                if (!fs.existsSync(entry.abs))
                    continue;
                this.good.set(key, {
                    abs: entry.abs,
                    existed: true,
                    content: fs.readFileSync(entry.abs, 'utf8')
                });
            }
            catch (e) {
                log('markGood eșuat pentru ' + entry.abs + ': ' + (e?.message ?? String(e)));
            }
        }
    }
    /**
     * Readuce fiecare fișier urmărit la ultima stare bună (sau, dacă nu există
     * checkpoint, la starea de dinainte de mesaj) și șterge fișierele noi.
     * La final starea internă este golită.
     */
    rollback() {
        const out = { restored: [], deleted: [], failed: [] };
        for (const [key, entry] of this.initial) {
            const target = this.good.get(key) ?? entry;
            try {
                if (target.existed) {
                    const current = fs.existsSync(target.abs)
                        ? fs.readFileSync(target.abs, 'utf8')
                        : null;
                    if (current !== target.content) {
                        fs.mkdirSync(path.dirname(target.abs), { recursive: true });
                        fs.writeFileSync(target.abs, target.content, 'utf8');
                        out.restored.push(target.abs);
                    }
                }
                else if (fs.existsSync(target.abs)) {
                    fs.rmSync(target.abs, { force: true });
                    out.deleted.push(target.abs);
                }
            }
            catch (e) {
                out.failed.push({ abs: target.abs, error: e?.message ?? String(e) });
            }
        }
        log('rollback: ' +
            out.restored.length +
            ' restaurate, ' +
            out.deleted.length +
            ' șterse, ' +
            out.failed.length +
            ' eșuate');
        this.reset();
        return out;
    }
}
exports.EditRollback = EditRollback;
//# sourceMappingURL=rollback.js.map