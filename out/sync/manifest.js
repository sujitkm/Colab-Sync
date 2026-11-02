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
exports.ManifestStore = void 0;
exports.migrateManifest = migrateManifest;
/**
 * Versioned sync manifest.
 *
 * The manifest is the engine's memory: for every synchronized path it records
 * the last observed local hash, remote hash, and the hash both sides agreed on
 * at the last successful sync. Three-way comparison against `lastSyncedHash`
 * is what makes conflict detection possible.
 *
 * The file lives at `.colabsync/manifest.json` inside the workspace and is
 * written atomically (tmp + rename). It contains no credentials.
 */
const fsp = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const types_1 = require("../types");
class ManifestStore {
    workspaceRoot;
    manifest;
    filePath;
    constructor(workspaceRoot, remoteRoot) {
        this.workspaceRoot = workspaceRoot;
        this.filePath = path.join(workspaceRoot, '.colabsync', 'manifest.json');
        this.manifest = {
            version: types_1.MANIFEST_VERSION,
            projectId: (0, node_crypto_1.randomUUID)(),
            remoteRoot,
            updatedAt: Date.now(),
            files: {},
        };
    }
    /** Load an existing manifest or initialize a fresh one. */
    static async load(workspaceRoot, remoteRoot) {
        const store = new ManifestStore(workspaceRoot, remoteRoot);
        try {
            const raw = await fsp.readFile(store.filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            store.manifest = migrateManifest(parsed, remoteRoot);
        }
        catch (err) {
            if (err.code !== 'ENOENT') {
                // Corrupt manifest: back it up instead of destroying information.
                const backup = `${store.filePath}.corrupt-${Date.now()}.bak`;
                await fsp
                    .rename(store.filePath, backup)
                    .catch(() => undefined /* best effort */);
            }
        }
        return store;
    }
    get data() {
        return this.manifest;
    }
    get projectId() {
        return this.manifest.projectId;
    }
    get(relPath) {
        return this.manifest.files[relPath];
    }
    set(relPath, entry) {
        this.manifest.files[relPath] = entry;
    }
    delete(relPath) {
        delete this.manifest.files[relPath];
    }
    /** All tracked paths. */
    paths() {
        return Object.keys(this.manifest.files);
    }
    /** Paths currently in a given state. */
    pathsInState(state) {
        return Object.entries(this.manifest.files)
            .filter(([, f]) => f.state === state)
            .map(([p]) => p);
    }
    /** Persist atomically. */
    async save() {
        this.manifest.updatedAt = Date.now();
        await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp-${process.pid}`;
        await fsp.writeFile(tmp, JSON.stringify(this.manifest, null, 2), 'utf-8');
        await fsp.rename(tmp, this.filePath);
    }
}
exports.ManifestStore = ManifestStore;
/**
 * Validate and migrate a parsed manifest to the current version.
 * Unknown newer versions are rejected rather than silently misread.
 */
function migrateManifest(parsed, remoteRoot) {
    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Manifest is not an object');
    }
    const version = parsed.version;
    if (typeof version !== 'number' || version < 1) {
        throw new Error('Manifest has no valid version');
    }
    if (version > types_1.MANIFEST_VERSION) {
        throw new Error(`Manifest version ${version} is newer than supported ${types_1.MANIFEST_VERSION}`);
    }
    // v1 is the current and only schema; future versions migrate here.
    const files = {};
    const rawFiles = parsed.files ?? {};
    for (const [p, raw] of Object.entries(rawFiles)) {
        const f = raw;
        files[p] = {
            localHash: typeof f.localHash === 'string' ? f.localHash : null,
            remoteHash: typeof f.remoteHash === 'string' ? f.remoteHash : null,
            lastSyncedHash: typeof f.lastSyncedHash === 'string' ? f.lastSyncedHash : null,
            size: typeof f.size === 'number' ? f.size : 0,
            mtime: typeof f.mtime === 'number' ? f.mtime : 0,
            remoteMtime: typeof f.remoteMtime === 'number' ? f.remoteMtime : 0,
            remoteSize: typeof f.remoteSize === 'number' ? f.remoteSize : 0,
            state: Object.values(types_1.SyncFileState).includes(f.state)
                ? f.state
                : types_1.SyncFileState.Unchanged,
        };
    }
    return {
        version: types_1.MANIFEST_VERSION,
        projectId: typeof parsed.projectId === 'string' ? parsed.projectId : (0, node_crypto_1.randomUUID)(),
        remoteRoot: typeof parsed.remoteRoot === 'string' ? parsed.remoteRoot : remoteRoot,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
        files,
    };
}
//# sourceMappingURL=manifest.js.map