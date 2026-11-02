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
exports.HashCache = void 0;
exports.hashFile = hashFile;
exports.hashBuffer = hashBuffer;
exports.hashFileCached = hashFileCached;
/**
 * Content hashing with metadata-keyed caching.
 *
 * Hashing is expensive for large research artifacts (CSVs, RDS, model files),
 * so callers are expected to compare size+mtime first and only hash when
 * metadata is inconclusive. The cache avoids re-hashing unchanged files.
 */
const node_crypto_1 = require("node:crypto");
const fs = __importStar(require("node:fs"));
/** In-memory hash cache keyed by absolute path. */
class HashCache {
    cache = new Map();
    maxEntries;
    constructor(maxEntries = 10_000) {
        this.maxEntries = maxEntries;
    }
    get(absPath, stat) {
        const entry = this.cache.get(absPath);
        if (entry && entry.size === stat.size && entry.mtime === stat.mtime) {
            return entry.hash;
        }
        return undefined;
    }
    set(absPath, stat, hash) {
        if (this.cache.size >= this.maxEntries) {
            // Drop the oldest entry (Map preserves insertion order).
            const oldest = this.cache.keys().next();
            if (!oldest.done) {
                this.cache.delete(oldest.value);
            }
        }
        this.cache.set(absPath, { size: stat.size, mtime: stat.mtime, hash });
    }
    invalidate(absPath) {
        this.cache.delete(absPath);
    }
    clear() {
        this.cache.clear();
    }
}
exports.HashCache = HashCache;
/** Stream-hash a local file. */
async function hashFile(absPath, algorithm = 'sha256') {
    return new Promise((resolve, reject) => {
        const hash = (0, node_crypto_1.createHash)(algorithm);
        const stream = fs.createReadStream(absPath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}
/** Hash an in-memory buffer (used for remote content already in memory). */
function hashBuffer(content, algorithm = 'sha256') {
    return (0, node_crypto_1.createHash)(algorithm).update(content).digest('hex');
}
/**
 * Hash a local file with caching: returns the cached value when size and
 * mtime are unchanged since the last hash.
 */
async function hashFileCached(absPath, stat, cache) {
    const cached = cache.get(absPath, stat);
    if (cached !== undefined) {
        return cached;
    }
    const hash = await hashFile(absPath);
    cache.set(absPath, stat, hash);
    return hash;
}
//# sourceMappingURL=hash.js.map