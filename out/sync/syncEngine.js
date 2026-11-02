"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncEngine = void 0;
const types_1 = require("../types");
const ignore_1 = require("../filesystem/ignore");
const hash_1 = require("./hash");
const syncQueue_1 = require("./syncQueue");
const emitter_1 = require("../util/emitter");
const DEFAULT_VERIFY_MAX_BYTES = 64 * 1024 * 1024;
const SELF_CHANGE_TTL_MS = 30_000;
class SyncEngine {
    options;
    remote = null;
    queue;
    hashCache;
    emitter = new emitter_1.Emitter();
    selfChanges = new Map();
    settledResults = [];
    conflicts = [];
    verifyMaxBytes;
    event = this.emitter.event;
    constructor(options) {
        this.options = options;
        this.hashCache = options.hashCache ?? new hash_1.HashCache();
        this.verifyMaxBytes = options.verifyMaxBytes ?? DEFAULT_VERIFY_MAX_BYTES;
        this.queue = new syncQueue_1.SyncQueue(options.config.transferConcurrency, (op, token) => this.execute(op, token), {
            maxAttempts: options.maxAttempts ?? 3,
            baseDelayMs: options.baseDelayMs ?? 1000,
            onRetry: (attempt, error) => {
                this.options.logger.warn(`Transfer attempt ${attempt} failed: ${errMsg(error)}`);
            },
        }, options.logger);
        this.queue.event((e) => {
            if (e.type === 'settled' && e.result) {
                this.settledResults.push(e.result);
                if (e.result.state === types_1.TransferState.Failed) {
                    const m = this.options.manifest.get(e.result.path);
                    if (m) {
                        m.state = types_1.SyncFileState.Failed;
                    }
                }
                this.emitter.fire({ type: 'settled', result: e.result });
            }
        });
    }
    get transferQueue() {
        return this.queue;
    }
    get currentConflicts() {
        return this.conflicts;
    }
    clearConflicts() {
        this.conflicts = [];
    }
    /** Attach/detach the remote filesystem (connect/disconnect). */
    setRemote(remote) {
        this.remote = remote;
    }
    get isRemoteAttached() {
        return this.remote !== null;
    }
    /** The currently attached remote filesystem, if any. */
    get remoteFs() {
        return this.remote;
    }
    requireRemote() {
        if (!this.remote) {
            throw new Error('No remote filesystem attached');
        }
        return this.remote;
    }
    // ------------------------------------------------------------------ plan
    /** Scan both sides and compute the sync plan without executing it. */
    async computePlan(direction = 'both') {
        if (!this.remote) {
            // Planning without a remote would misread every tracked file as
            // remotely deleted. Never plan while disconnected.
            throw new Error('Cannot plan synchronization while disconnected');
        }
        const { localFs, manifest, config } = this.options;
        const ignore = new ignore_1.IgnoreRules(config.include, config.exclude);
        const localFiles = (await localFs.list()).filter((f) => ignore.isIncluded(f.path));
        const remoteFiles = this.remote
            ? (await this.remote.list()).filter((f) => ignore.isIncluded(f.path))
            : [];
        const localMap = new Map(localFiles.map((f) => [f.path, f]));
        const remoteMap = new Map(remoteFiles.map((f) => [f.path, f]));
        // Runtime-loss guard: the manifest believes files exist remotely but the
        // remote ROOT is gone -> recycled runtime. Rebuild; never delete locally.
        // (An existing-but-empty root means deliberate deletions, not loss.)
        const manifestHasRemote = manifest
            .paths()
            .some((p) => manifest.get(p)?.remoteHash !== null);
        const rootExists = await this.remote.rootExists();
        const remoteLost = !rootExists && manifestHasRemote;
        const operations = [];
        const conflicts = [];
        const states = new Map();
        const allPaths = new Set([
            ...localMap.keys(),
            ...remoteMap.keys(),
            ...manifest.paths(),
        ]);
        for (const p of allPaths) {
            if (!ignore.isIncluded(p)) {
                // Config now excludes a previously tracked path: stop tracking it,
                // leave both copies untouched.
                if (manifest.get(p)) {
                    manifest.delete(p);
                    states.set(p, types_1.SyncFileState.Ignored);
                }
                continue;
            }
            const l = localMap.get(p) ?? null;
            const r = remoteMap.get(p) ?? null;
            const m = manifest.get(p);
            if (!m) {
                await this.planUntracked(p, l, r, direction, operations, conflicts, states);
                continue;
            }
            if (l && r) {
                await this.planTrackedBothPresent(p, l, r, m, direction, operations, conflicts, states);
            }
            else if (l && !r) {
                this.planTrackedRemoteMissing(p, l, m, direction, remoteLost, operations, states);
            }
            else if (!l && r) {
                this.planTrackedLocalMissing(p, r, m, direction, operations, states);
            }
            else {
                // Gone on both sides: drop from manifest.
                manifest.delete(p);
            }
        }
        const plan = { operations, conflicts, states, remoteLost };
        this.conflicts = conflicts;
        this.emitter.fire({ type: 'plan', plan, conflicts });
        if (conflicts.length > 0) {
            this.emitter.fire({ type: 'conflicts', conflicts });
        }
        if (remoteLost) {
            this.emitter.fire({ type: 'remote-lost' });
            this.options.logger.warn('Remote project is empty while the manifest tracks remote files. ' +
                'Assuming a recycled runtime: rebuilding remote from local. Local files are safe.');
        }
        return plan;
    }
    async planUntracked(p, l, r, direction, operations, conflicts, states) {
        if (l && !r) {
            states.set(p, types_1.SyncFileState.LocalOnly);
            if (direction !== 'pull') {
                operations.push(this.op(p, types_1.TransferDirection.Upload, l.size, types_1.SyncFileState.LocalOnly));
            }
            return;
        }
        if (!l && r) {
            states.set(p, types_1.SyncFileState.RemoteOnly);
            if (direction !== 'push') {
                operations.push(this.op(p, types_1.TransferDirection.Download, r.size, types_1.SyncFileState.RemoteOnly));
            }
            return;
        }
        if (l && r) {
            // Present on both sides but never synced together.
            if (l.size !== r.size) {
                states.set(p, types_1.SyncFileState.Conflict);
                conflicts.push(await this.buildConflict(p, l, r, null));
                return;
            }
            if (l.size <= this.verifyMaxBytes) {
                const remoteContent = await this.requireRemote().read(p);
                const remoteHash = (0, hash_1.hashBuffer)(remoteContent);
                const localHash = await (0, hash_1.hashFileCached)(this.options.localFs.resolve(p), l, this.hashCache);
                if (localHash === remoteHash) {
                    // Identical content: adopt into the manifest without transferring.
                    this.options.manifest.set(p, {
                        localHash,
                        remoteHash,
                        lastSyncedHash: localHash,
                        size: l.size,
                        mtime: l.mtime,
                        remoteMtime: r.mtime,
                        remoteSize: r.size,
                        state: types_1.SyncFileState.Unchanged,
                    });
                    states.set(p, types_1.SyncFileState.Unchanged);
                    return;
                }
                states.set(p, types_1.SyncFileState.Conflict);
                conflicts.push({
                    path: p,
                    localStat: l,
                    remoteStat: r,
                    localHash,
                    remoteHash,
                    detectedAt: Date.now(),
                });
                return;
            }
            // Too large to auto-verify: treat as conflict, let the user decide.
            states.set(p, types_1.SyncFileState.Conflict);
            conflicts.push(await this.buildConflict(p, l, r, null));
        }
    }
    async planTrackedBothPresent(p, l, r, m, direction, operations, conflicts, states) {
        const localChanged = await this.hasLocalChanged(l, m);
        const remoteChanged = await this.hasRemoteChanged(p, r, m);
        if (!localChanged && !remoteChanged) {
            states.set(p, types_1.SyncFileState.Unchanged);
            m.state = types_1.SyncFileState.Unchanged;
            return;
        }
        if (localChanged && !remoteChanged) {
            states.set(p, types_1.SyncFileState.LocalChanged);
            if (direction !== 'pull') {
                operations.push(this.op(p, types_1.TransferDirection.Upload, l.size, types_1.SyncFileState.LocalChanged));
            }
            return;
        }
        if (!localChanged && remoteChanged) {
            states.set(p, types_1.SyncFileState.RemoteChanged);
            if (direction !== 'push') {
                operations.push(this.op(p, types_1.TransferDirection.Download, r.size, types_1.SyncFileState.RemoteChanged));
            }
            return;
        }
        // Notebook files are intentionally conflict-free. Running a Colab
        // notebook can change outputs, execution counts, and metadata, while
        // the user may also edit code locally. When both sides changed, the
        // local notebook is authoritative during normal/bidirectional sync so
        // Connect/Sync never interrupts the user with a danger notification.
        // A manual Pull still means the remote notebook wins.
        if (p.toLowerCase().endsWith('.ipynb')) {
            if (direction === 'pull') {
                states.set(p, types_1.SyncFileState.RemoteChanged);
                operations.push(this.op(p, types_1.TransferDirection.Download, r.size, types_1.SyncFileState.RemoteChanged));
            }
            else {
                states.set(p, types_1.SyncFileState.LocalChanged);
                operations.push(this.op(p, types_1.TransferDirection.Upload, l.size, types_1.SyncFileState.LocalChanged));
            }
            return;
        }
        states.set(p, types_1.SyncFileState.Conflict);
        m.state = types_1.SyncFileState.Conflict;
        conflicts.push(await this.buildConflict(p, l, r, m));
    }
    planTrackedRemoteMissing(p, l, m, direction, remoteLost, operations, states) {
        if (m.remoteHash === null) {
            // Never made it to the remote: still local-only.
            states.set(p, types_1.SyncFileState.LocalOnly);
            if (direction !== 'pull') {
                operations.push(this.op(p, types_1.TransferDirection.Upload, l.size, types_1.SyncFileState.LocalOnly));
            }
            return;
        }
        states.set(p, types_1.SyncFileState.RemoteDeleted);
        const { deleteSync } = this.options.config;
        if (deleteSync && !remoteLost && direction === 'both') {
            // Explicit opt-in: propagate the remote deletion to local.
            operations.push(this.op(p, types_1.TransferDirection.DeleteLocal, 0, types_1.SyncFileState.RemoteDeleted));
        }
        else if (direction !== 'pull') {
            // Safe default (or runtime rebuild): restore the remote copy.
            operations.push(this.op(p, types_1.TransferDirection.Upload, l.size, types_1.SyncFileState.RemoteDeleted));
        }
    }
    planTrackedLocalMissing(p, r, m, direction, operations, states) {
        if (m.localHash === null) {
            states.set(p, types_1.SyncFileState.RemoteOnly);
            if (direction !== 'push') {
                operations.push(this.op(p, types_1.TransferDirection.Download, r.size, types_1.SyncFileState.RemoteOnly));
            }
            return;
        }
        states.set(p, types_1.SyncFileState.LocalDeleted);
        // A local deletion is authoritative for the local workspace: propagate
        // it to the attached remote project during bidirectional sync. This
        // keeps local delete -> remote delete working even for projects created
        // with the older deleteSync:false default.
        if (direction === 'both') {
            operations.push(this.op(p, types_1.TransferDirection.DeleteRemote, 0, types_1.SyncFileState.LocalDeleted));
        }
        else if (direction !== 'push') {
            // Pull-only mode never deletes the remote copy.
            operations.push(this.op(p, types_1.TransferDirection.Download, r.size, types_1.SyncFileState.LocalDeleted));
        }
    }
    // ------------------------------------------------------------------ sync
    /** Compute a plan and execute all non-conflict operations. */
    async sync(direction = 'both') {
        const start = Date.now();
        this.settledResults = [];
        const plan = await this.computePlan(direction);
        this.queue.enqueue(plan.operations);
        await this.queue.whenDrained();
        await this.options.manifest.save();
        const summary = {
            plan,
            results: [...this.settledResults],
            durationMs: Date.now() - start,
        };
        this.emitter.fire({ type: 'synced' });
        return summary;
    }
    /**
     * First-use bootstrap: make the local project authoritative, upload every
     * included local file, and seed the manifest from successful transfers.
     * This is intentionally separate from three-way sync so a brand-new
     * project is not blocked by unrelated remote files from another attempt.
     */
    async bootstrapLocalToRemote() {
        if (!this.remote) {
            throw new Error('No remote filesystem attached');
        }
        const { localFs, manifest, config } = this.options;
        const ignore = new ignore_1.IgnoreRules(config.include, config.exclude);
        // Preserve the local directory tree during first bootstrap, including
        // empty folders. Files alone cannot represent an empty directory.
        const localDirs = (await localFs.listDirectories()).filter((d) => ignore.isIncluded(d.path));
        for (const dir of localDirs) {
            await this.requireRemote().mkdir(dir.path);
        }
        const localFiles = (await localFs.list()).filter((f) => ignore.isIncluded(f.path));
        if (localFiles.length === 0) {
            this.options.logger.info(`Initial local bootstrap created ${localDirs.length} remote director${localDirs.length === 1 ? 'y' : 'ies'}; no files to upload`);
            return;
        }
        const ops = localFiles.map((f) => this.op(f.path, types_1.TransferDirection.Upload, f.size, types_1.SyncFileState.LocalChanged));
        this.settledResults = [];
        this.queue.enqueue(ops);
        await this.queue.whenDrained();
        const failed = this.settledResults.filter((r) => r.state === types_1.TransferState.Failed || r.state === types_1.TransferState.Cancelled);
        if (failed.length > 0) {
            throw new Error(`Initial local bootstrap failed for ${failed.length} file(s)`);
        }
        await manifest.save();
        this.options.logger.info(`Initial local bootstrap created ${localDirs.length} remote director${localDirs.length === 1 ? 'y' : 'ies'} and uploaded ${this.settledResults.length} file(s) to the remote project`);
    }
    /** Resolve a conflict explicitly. Never called implicitly. */
    async resolveConflict(conflict, resolution) {
        const op = resolution === 'local'
            ? this.op(conflict.path, types_1.TransferDirection.Upload, conflict.localStat?.size ?? 0, types_1.SyncFileState.Conflict)
            : this.op(conflict.path, types_1.TransferDirection.Download, conflict.remoteStat?.size ?? 0, types_1.SyncFileState.Conflict);
        this.settledResults = [];
        this.queue.enqueue([op]);
        await this.queue.whenDrained();
        this.conflicts = this.conflicts.filter((c) => c.path !== conflict.path);
        await this.options.manifest.save();
    }
    // ------------------------------------------------------- local watching
    /**
     * Targeted handling of one local filesystem event (from the debounced
     * watcher). Hash-verified against the manifest so self-triggered echoes
     * are ignored and no full rescan happens per event.
     */
    async handleLocalEvent(relPath, kind) {
        if (!this.remote) {
            return;
        }
        const { config, manifest, localFs } = this.options;
        const ignore = new ignore_1.IgnoreRules(config.include, config.exclude);
        if (!ignore.isIncluded(relPath)) {
            return;
        }
        if (kind === 'deleted') {
            const m = manifest.get(relPath);
            if (m) {
                if (m.remoteHash !== null) {
                    // Local deletion is propagated immediately to the remote copy.
                    // Do not depend on the legacy deleteSync:false project setting.
                    this.queue.enqueue([
                        this.op(relPath, types_1.TransferDirection.DeleteRemote, 0, types_1.SyncFileState.LocalDeleted),
                    ]);
                }
                else {
                    m.state = types_1.SyncFileState.LocalDeleted;
                    m.localHash = null;
                    await manifest.save();
                }
                this.emitter.fire({ type: 'local-event', path: relPath });
                return;
            }
            // Directories are intentionally not stored in the file manifest. If
            // a local directory disappears, detect the corresponding remote
            // directory and remove the whole subtree so empty folders and their
            // contents stay mirrored.
            try {
                const remoteStat = await this.requireRemote().stat(relPath);
                if (remoteStat?.isDirectory) {
                    this.queue.enqueue([
                        this.op(relPath, types_1.TransferDirection.DeleteRemote, 0, types_1.SyncFileState.LocalDeleted),
                    ]);
                }
            }
            catch (error) {
                this.options.logger.debug?.(`Remote directory delete check skipped for ${relPath}: ${error?.message ?? error}`);
            }
            this.emitter.fire({ type: 'local-event', path: relPath });
            return;
        }
        const stat = await localFs.stat(relPath);
        if (!stat) {
            return;
        }
        if (stat.isDirectory) {
            // A directory create/change event must materialize remotely even when
            // the directory is empty (there may be no file event to trigger an
            // upload). `mkdir` is idempotent for the supported remote filesystems.
            await this.requireRemote().mkdir(relPath);
            this.emitter.fire({ type: 'local-event', path: relPath });
            return;
        }
        if (stat.size > config.maxFileSize) {
            this.options.logger.warn(`Skipping ${relPath}: ${stat.size} bytes exceeds maxFileSize ${config.maxFileSize}`);
            return;
        }
        const m = manifest.get(relPath);
        if (m && stat.size === m.size && stat.mtime === m.mtime) {
            return; // metadata identical to manifest: nothing to do
        }
        const hash = await (0, hash_1.hashFileCached)(localFs.resolve(relPath), stat, this.hashCache);
        if (m && hash === m.localHash) {
            // Content identical (e.g. touch, or our own download echo).
            m.size = stat.size;
            m.mtime = stat.mtime;
            return;
        }
        if (this.consumeSelfChange(relPath, hash)) {
            if (m) {
                m.size = stat.size;
                m.mtime = stat.mtime;
            }
            return;
        }
        // Notebook edits are user-authored and should never produce the
        // conflict danger notification. When a notebook is edited locally,
        // the local copy is authoritative and is uploaded even if Colab has
        // changed execution metadata/outputs in the meantime.
        if (relPath.toLowerCase().endsWith('.ipynb')) {
            manifest.set(relPath, {
                localHash: hash,
                remoteHash: m?.remoteHash ?? null,
                lastSyncedHash: m?.lastSyncedHash ?? null,
                size: stat.size,
                mtime: stat.mtime,
                remoteMtime: m?.remoteMtime ?? 0,
                remoteSize: m?.remoteSize ?? 0,
                state: types_1.SyncFileState.Syncing,
            });
            this.queue.enqueue([
                this.op(relPath, types_1.TransferDirection.Upload, stat.size, types_1.SyncFileState.LocalChanged),
            ]);
            this.emitter.fire({ type: 'local-event', path: relPath });
            return;
        }
        // Genuine local change. Guard against clobbering a concurrently
        // changed remote file: that is a conflict, not an upload.
        const rstat = await this.requireRemote().stat(relPath);
        if (m && rstat && this.hasRemoteChanged(rstat, m)) {
            m.state = types_1.SyncFileState.Conflict;
            const conflict = {
                path: relPath,
                localStat: stat,
                remoteStat: rstat,
                localHash: hash,
                remoteHash: null,
                detectedAt: Date.now(),
            };
            this.conflicts = [
                ...this.conflicts.filter((c) => c.path !== relPath),
                conflict,
            ];
            await manifest.save();
            this.emitter.fire({ type: 'conflicts', conflicts: this.conflicts });
            return;
        }
        manifest.set(relPath, {
            localHash: m?.localHash ?? null,
            remoteHash: m?.remoteHash ?? null,
            lastSyncedHash: m?.lastSyncedHash ?? null,
            size: stat.size,
            mtime: stat.mtime,
            remoteMtime: m?.remoteMtime ?? 0,
            remoteSize: m?.remoteSize ?? 0,
            state: types_1.SyncFileState.Syncing,
        });
        this.queue.enqueue([
            this.op(relPath, types_1.TransferDirection.Upload, stat.size, types_1.SyncFileState.LocalChanged),
        ]);
        this.emitter.fire({ type: 'local-event', path: relPath });
    }
    // -------------------------------------------------------------- executor
    async execute(op, token) {
        const remote = this.requireRemote();
        const { localFs, manifest, config } = this.options;
        switch (op.direction) {
            case types_1.TransferDirection.Upload: {
                const content = await localFs.read(op.path);
                if (content.length > config.maxFileSize) {
                    throw new Error(`File exceeds maxFileSize (${content.length} > ${config.maxFileSize})`);
                }
                if (token.cancelled) {
                    throw new types_1.CancelledError();
                }
                const hash = (0, hash_1.hashBuffer)(content);
                const wr = await remote.write(op.path, content);
                const lst = await localFs.stat(op.path);
                manifest.set(op.path, {
                    localHash: hash,
                    remoteHash: hash,
                    lastSyncedHash: hash,
                    size: lst?.size ?? content.length,
                    mtime: lst?.mtime ?? Date.now(),
                    remoteMtime: wr.mtime,
                    remoteSize: wr.size,
                    state: types_1.SyncFileState.Unchanged,
                });
                this.noteSelfChange(op.path, hash);
                return {
                    path: op.path,
                    direction: op.direction,
                    state: types_1.TransferState.Completed,
                    bytes: content.length,
                    hash,
                    remoteMtime: wr.mtime,
                    attempts: 1,
                };
            }
            case types_1.TransferDirection.Download: {
                const before = await remote.stat(op.path);
                const content = await remote.read(op.path);
                if (token.cancelled) {
                    throw new types_1.CancelledError();
                }
                const hash = (0, hash_1.hashBuffer)(content);
                const m = manifest.get(op.path);
                const localStillValid = m !== undefined &&
                    m.localHash === hash &&
                    (await localFs.stat(op.path)) !== null;
                if (m && m.lastSyncedHash !== null && m.lastSyncedHash === hash && localStillValid) {
                    // Remote metadata moved but content is identical and the local
                    // copy is intact: no write needed.
                    m.remoteMtime = before?.mtime ?? m.remoteMtime;
                    m.remoteSize = content.length;
                    m.remoteHash = hash;
                    m.state = types_1.SyncFileState.Unchanged;
                    return {
                        path: op.path,
                        direction: op.direction,
                        state: types_1.TransferState.Completed,
                        bytes: 0,
                        hash,
                        attempts: 1,
                    };
                }
                const lst = await localFs.write(op.path, content);
                manifest.set(op.path, {
                    localHash: hash,
                    remoteHash: hash,
                    lastSyncedHash: hash,
                    size: lst.size,
                    mtime: lst.mtime,
                    remoteMtime: before?.mtime ?? Date.now(),
                    remoteSize: content.length,
                    state: types_1.SyncFileState.Unchanged,
                });
                this.noteSelfChange(op.path, hash);
                return {
                    path: op.path,
                    direction: op.direction,
                    state: types_1.TransferState.Completed,
                    bytes: content.length,
                    hash,
                    attempts: 1,
                };
            }
            case types_1.TransferDirection.DeleteLocal: {
                await localFs.delete(op.path);
                this.hashCache.invalidate(localFs.resolve(op.path));
                manifest.delete(op.path);
                return {
                    path: op.path,
                    direction: op.direction,
                    state: types_1.TransferState.Completed,
                    bytes: 0,
                    attempts: 1,
                };
            }
            case types_1.TransferDirection.DeleteRemote: {
                await remote.delete(op.path);
                const prefix = `${op.path}/`;
                for (const tracked of manifest.paths()) {
                    if (tracked === op.path || tracked.startsWith(prefix)) {
                        manifest.delete(tracked);
                    }
                }
                return {
                    path: op.path,
                    direction: op.direction,
                    state: types_1.TransferState.Completed,
                    bytes: 0,
                    attempts: 1,
                };
            }
        }
    }
    // -------------------------------------------------------------- helpers
    async hasLocalChanged(stat, m) {
        if (stat.size === m.size && stat.mtime === m.mtime) {
            return false;
        }
        const hash = await (0, hash_1.hashFileCached)(this.options.localFs.resolve(stat.path), stat, this.hashCache);
        return hash !== m.localHash;
    }
    async hasRemoteChanged(relPath, stat, m) {
        if (stat.size === m.remoteSize && stat.mtime === m.remoteMtime) {
            return false;
        }
        // Colab/IRkernel metadata can report a different mtime even when the
        // file content has not changed. For reasonably sized files, verify the
        // content hash before declaring a remote change. This prevents false
        // conflicts after connect and during polling.
        if (this.remote && stat.size === m.remoteSize && m.remoteHash && stat.size <= this.verifyMaxBytes) {
            try {
                const content = await this.remote.read(relPath);
                const remoteHash = (0, hash_1.hashBuffer)(content);
                if (remoteHash === m.remoteHash) {
                    m.remoteMtime = stat.mtime;
                    m.remoteSize = stat.size;
                    m.state = types_1.SyncFileState.Unchanged;
                    return false;
                }
                return true;
            }
            catch {
                // If verification is unavailable, fall back to metadata change.
                return true;
            }
        }
        return true;
    }
    async buildConflict(p, l, r, m) {
        let localHash = m?.localHash ?? null;
        if (l && !localHash) {
            localHash = await (0, hash_1.hashFileCached)(this.options.localFs.resolve(p), l, this.hashCache);
        }
        return {
            path: p,
            localStat: l,
            remoteStat: r,
            localHash,
            remoteHash: m?.remoteHash ?? null,
            detectedAt: Date.now(),
        };
    }
    op(path, direction, size, reason) {
        return { path, direction, size, reason };
    }
    noteSelfChange(path, hash) {
        this.selfChanges.set(path, { hash, at: Date.now() });
    }
    consumeSelfChange(path, hash) {
        const entry = this.selfChanges.get(path);
        if (!entry) {
            return false;
        }
        if (Date.now() - entry.at > SELF_CHANGE_TTL_MS) {
            this.selfChanges.delete(path);
            return false;
        }
        if (entry.hash === hash) {
            this.selfChanges.delete(path);
            return true;
        }
        return false;
    }
}
exports.SyncEngine = SyncEngine;
function notebookCodeEquivalent(localContent, remoteContent) {
    try {
        const local = JSON.parse(localContent.toString('utf8'));
        const remote = JSON.parse(remoteContent.toString('utf8'));
        const cells = (nb) => (Array.isArray(nb?.cells) ? nb.cells : []).map((cell) => ({
            cell_type: cell?.cell_type ?? null,
            source: Array.isArray(cell?.source) ? cell.source : String(cell?.source ?? ''),
            id: cell?.id ?? null,
        }));
        return JSON.stringify(cells(local)) === JSON.stringify(cells(remote));
    }
    catch {
        return false;
    }
}

function errMsg(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=syncEngine.js.map