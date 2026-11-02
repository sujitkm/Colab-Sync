"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockRemoteFileSystem = void 0;
exports.transient = transient;
const pathSafety_1 = require("../filesystem/pathSafety");
const remoteFileSystem_1 = require("./remoteFileSystem");
class MockRemoteFileSystem {
    id = 'mock';
    files = new Map();
    latencyMs = 0;
    failure = { kind: 'none' };
    failureCounts = new Map();
    /** Counters for assertions. */
    calls = {
        list: 0,
        stat: 0,
        read: 0,
        write: 0,
        delete: 0,
        mkdir: 0,
        ping: 0,
    };
    setLatency(ms) {
        this.latencyMs = ms;
    }
    /** Inject failures for a given operation name (e.g. 'write'). */
    injectFailure(operation, mode) {
        this.failure = mode;
        this.failureOp = operation;
    }
    failureOp = null;
    clearFailures() {
        this.failure = { kind: 'none' };
        this.failureOp = null;
        this.failureCounts.clear();
    }
    /** Test helper: seed a file directly. */
    seed(relPath, content, mtime = Date.now()) {
        const rel = (0, pathSafety_1.normalizeRelativePath)(relPath);
        this.files.set(rel, {
            content: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8'),
            mtime,
        });
    }
    /** Test helper: read seeded content directly. */
    content(relPath) {
        return this.files.get((0, pathSafety_1.normalizeRelativePath)(relPath))?.content;
    }
    rootAlive = true;
    /** Test helper: simulate a recycled runtime (root directory gone). */
    wipe() {
        this.files.clear();
        this.rootAlive = false;
    }
    /** Test helper: control root existence directly. */
    setRootAlive(alive) {
        this.rootAlive = alive;
    }
    async rootExists() {
        return this.rootAlive;
    }
    async gate(op) {
        this.calls[op] += 1;
        if (this.latencyMs > 0) {
            await new Promise((r) => setTimeout(r, this.latencyMs));
        }
        if (this.failureOp === op && this.failure.kind !== 'none') {
            if (this.failure.kind === 'always') {
                throw this.failure.error;
            }
            const seen = this.failureCounts.get(op) ?? 0;
            if (seen < this.failure.count) {
                this.failureCounts.set(op, seen + 1);
                throw this.failure.error;
            }
        }
    }
    async list() {
        await this.gate('list');
        return [...this.files.entries()].map(([p, n]) => ({
            path: p,
            size: n.content.length,
            mtime: n.mtime,
            isDirectory: false,
        }));
    }
    async stat(relPath) {
        await this.gate('stat');
        const rel = (0, pathSafety_1.normalizeRelativePath)(relPath);
        const node = this.files.get(rel);
        if (!node) {
            return null;
        }
        return {
            path: rel,
            size: node.content.length,
            mtime: node.mtime,
            isDirectory: false,
        };
    }
    async read(relPath) {
        await this.gate('read');
        const rel = (0, pathSafety_1.normalizeRelativePath)(relPath);
        const node = this.files.get(rel);
        if (!node) {
            throw new remoteFileSystem_1.RemoteNotFoundError(`No such remote file: ${rel}`, rel);
        }
        return Buffer.from(node.content);
    }
    async write(relPath, content) {
        await this.gate('write');
        const rel = (0, pathSafety_1.normalizeRelativePath)(relPath);
        this.rootAlive = true;
        this.files.set(rel, { content: Buffer.from(content), mtime: Date.now() });
        return { mtime: this.files.get(rel)?.mtime ?? Date.now(), size: content.length };
    }
    async delete(relPath) {
        await this.gate('delete');
        const rel = (0, pathSafety_1.normalizeRelativePath)(relPath);
        if (!this.files.delete(rel)) {
            throw new remoteFileSystem_1.RemoteNotFoundError(`No such remote file: ${rel}`, rel);
        }
    }
    async mkdir(_relPath) {
        await this.gate('mkdir');
        // Directories are implicit in the mock.
    }
    async ping() {
        await this.gate('ping');
        return true;
    }
}
exports.MockRemoteFileSystem = MockRemoteFileSystem;
/** Convenience error for tests. */
function transient(message = 'injected transient failure') {
    return new remoteFileSystem_1.RemoteTransientError(message);
}
//# sourceMappingURL=mockRemoteFileSystem.js.map