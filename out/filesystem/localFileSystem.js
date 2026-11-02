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
exports.LocalFileSystem = exports.PARTIAL_SUFFIX = void 0;
const fsp = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const pathSafety_1 = require("./pathSafety");
exports.PARTIAL_SUFFIX = '.colabsync-part';
class LocalFileSystem {
    root;
    constructor(root) {
        this.root = root;
    }
    /** Absolute path for a relative path, with containment enforcement. */
    resolve(relPath) {
        return (0, pathSafety_1.resolveContained)(this.root, relPath);
    }
    /** Stat a relative path. Returns null when missing. */
    async stat(relPath) {
        const rel = (0, pathSafety_1.normalizeRelativePath)(relPath);
        const abs = this.resolve(rel);
        let st;
        try {
            // lstat so symlinked entries are reported as their own metadata;
            // symlink escapes are rejected by realpath below.
            st = await fsp.lstat(abs);
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                return null;
            }
            throw err;
        }
        if (st.isSymbolicLink()) {
            const real = await fsp.realpath(abs).catch(() => null);
            if (real === null || !this.isInsideRoot(real)) {
                // Refuse to synchronize symlinks that escape the workspace.
                return null;
            }
            st = await fsp.stat(abs);
        }
        return {
            path: rel,
            size: st.size,
            mtime: Math.round(st.mtimeMs),
            isDirectory: st.isDirectory(),
        };
    }
    /** Recursively list all files under the root (relative POSIX paths). */
    async list() {
        const out = [];
        const walk = async (relDir) => {
            const absDir = relDir === '' ? path.resolve(this.root) : this.resolve(relDir);
            let entries;
            try {
                entries = await fsp.readdir(absDir, { withFileTypes: true });
            }
            catch (err) {
                if (err.code === 'ENOENT') {
                    return;
                }
                throw err;
            }
            for (const entry of entries) {
                const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
                if (entry.name.endsWith(exports.PARTIAL_SUFFIX)) {
                    // Never surface in-flight partial transfers.
                    continue;
                }
                if (entry.isDirectory()) {
                    await walk(rel);
                }
                else if (entry.isFile()) {
                    const st = await this.stat(rel);
                    if (st && !st.isDirectory) {
                        out.push(st);
                    }
                }
                else if (entry.isSymbolicLink()) {
                    const st = await this.stat(rel);
                    if (st && !st.isDirectory) {
                        out.push(st);
                    }
                }
            }
        };
        await walk('');
        return out;
    }
    /** Recursively list all directories under the root (relative POSIX paths). */
    async listDirectories() {
        const out = [];
        const walk = async (relDir) => {
            const absDir = relDir === '' ? path.resolve(this.root) : this.resolve(relDir);
            let entries;
            try {
                entries = await fsp.readdir(absDir, { withFileTypes: true });
            }
            catch (err) {
                if (err.code === 'ENOENT') {
                    return;
                }
                throw err;
            }
            for (const entry of entries) {
                const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
                if (entry.name.endsWith(exports.PARTIAL_SUFFIX)) {
                    continue;
                }
                if (entry.isDirectory()) {
                    out.push({ path: rel, isDirectory: true });
                    await walk(rel);
                }
            }
        };
        await walk('');
        // Parent directories first so remote mkdir implementations that create
        // one level at a time always receive a valid parent before children.
        out.sort((a, b) => {
            const ad = a.path.split('/').length;
            const bd = b.path.split('/').length;
            return ad - bd || a.path.localeCompare(b.path);
        });
        return out;
    }
    async read(relPath) {
        return fsp.readFile(this.resolve(relPath));
    }
    /**
     * Atomically write content to a relative path.
     * Returns the final stat of the written file.
     */
    async write(relPath, content) {
        const abs = this.resolve(relPath);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        const tmp = `${abs}${exports.PARTIAL_SUFFIX}`;
        const handle = await fsp.open(tmp, 'w');
        try {
            await handle.write(content, 0, content.length, 0);
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await fsp.rename(tmp, abs);
        const st = await fsp.stat(abs);
        return {
            path: (0, pathSafety_1.normalizeRelativePath)(relPath),
            size: st.size,
            mtime: Math.round(st.mtimeMs),
            isDirectory: false,
        };
    }
    /** Delete a file. Returns false when it did not exist. */
    async delete(relPath) {
        const abs = this.resolve(relPath);
        try {
            await fsp.unlink(abs);
            return true;
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                return false;
            }
            throw err;
        }
    }
    async mkdir(relPath) {
        await fsp.mkdir(this.resolve(relPath), { recursive: true });
    }
    /** Ensure parent directories for a relative file path exist. */
    async ensureParent(relPath) {
        const parent = (0, pathSafety_1.parentPath)((0, pathSafety_1.normalizeRelativePath)(relPath));
        if (parent !== '') {
            await this.mkdir(parent);
        }
    }
    isInsideRoot(abs) {
        const absRoot = path.resolve(this.root);
        const resolved = path.resolve(abs);
        return resolved === absRoot || resolved.startsWith(absRoot + path.sep);
    }
}
exports.LocalFileSystem = LocalFileSystem;
//# sourceMappingURL=localFileSystem.js.map