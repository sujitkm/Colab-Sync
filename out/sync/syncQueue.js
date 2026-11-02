"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncQueue = void 0;
/**
 * Bounded-concurrency transfer queue.
 *
 * - One operation per path at a time (a newer operation for the same path
 *   replaces a still-pending one).
 * - At most `concurrency` transfers run simultaneously.
 * - Every operation is observable through queue events for UI updates.
 * - Cancellation is per-path or queue-wide; cancelling never leaves partial
 *   files behind (filesystems write via temp + rename).
 */
const types_1 = require("../types");
const types_2 = require("../types");
const retry_1 = require("./retry");
const emitter_1 = require("../util/emitter");
class SyncQueue {
    concurrency;
    executor;
    retry;
    logger;
    pending = [];
    active = new Map();
    emitter = new emitter_1.Emitter();
    running = 0;
    drainWaiters = [];
    event = this.emitter.event;
    constructor(concurrency, executor, retry, logger) {
        this.concurrency = concurrency;
        this.executor = executor;
        this.retry = retry;
        this.logger = logger;
    }
    setConcurrency(concurrency) {
        this.concurrency = Math.max(1, concurrency);
        this.pump();
    }
    get pendingCount() {
        return this.pending.length;
    }
    get activeCount() {
        return this.active.size;
    }
    /** Pending uploads (for UI). */
    pendingUploads() {
        return this.pending
            .filter((i) => i.op.direction === types_1.TransferDirection.Upload)
            .map((i) => i.op);
    }
    /** Pending downloads (for UI). */
    pendingDownloads() {
        return this.pending
            .filter((i) => i.op.direction === types_1.TransferDirection.Download)
            .map((i) => i.op);
    }
    /** Enqueue operations; dedupes by path. */
    enqueue(ops) {
        for (const op of ops) {
            // Replace a still-pending operation for the same path.
            this.pending = this.pending.filter((i) => i.op.path !== op.path);
            if (this.active.has(op.path)) {
                // Already transferring this path; the post-transfer manifest update
                // makes a stale duplicate unnecessary.
                continue;
            }
            this.pending.push({ op, token: new types_1.BasicCancelToken(), enqueuedAt: Date.now() });
            this.emitter.fire({
                type: 'enqueued',
                operation: op,
                pending: this.pending.length,
                active: this.active.size,
            });
        }
        this.pump();
    }
    /** Cancel pending (not active) transfer for a path. */
    cancel(path) {
        this.pending = this.pending.filter((i) => i.op.path !== path);
        this.active.get(path)?.token.cancel();
    }
    cancelAll() {
        for (const item of this.pending) {
            item.token.cancel();
        }
        this.pending = [];
        for (const item of this.active.values()) {
            item.token.cancel();
        }
    }
    /** Resolves when the queue is fully drained (nothing pending or active). */
    async whenDrained() {
        if (this.pending.length === 0 && this.active.size === 0) {
            return;
        }
        return new Promise((resolve) => this.drainWaiters.push(resolve));
    }
    pump() {
        while (this.running < this.concurrency && this.pending.length > 0) {
            const item = this.pending.shift();
            if (!item) {
                break;
            }
            if (item.token.cancelled) {
                continue;
            }
            this.active.set(item.op.path, item);
            this.running += 1;
            void this.run(item);
        }
    }
    async run(item) {
        const { op, token } = item;
        this.emitter.fire({
            type: 'started',
            operation: op,
            pending: this.pending.length,
            active: this.active.size,
        });
        let result;
        try {
            const { value, attempts } = await (0, retry_1.withRetry)(() => this.executor(op, token), {
                ...this.retry,
                token,
                onRetry: (attempt, error, delayMs) => {
                    this.logger.warn(`Retry ${attempt} for ${op.path} (${op.direction}) after error: ${errMsg(error)}; waiting ${Math.round(delayMs)}ms`);
                    this.retry.onRetry?.(attempt, error, delayMs);
                },
            });
            result = { ...value, attempts };
        }
        catch (error) {
            const cancelled = error instanceof types_2.CancelledError;
            result = {
                path: op.path,
                direction: op.direction,
                state: cancelled ? types_1.TransferState.Cancelled : types_1.TransferState.Failed,
                bytes: 0,
                attempts: this.retry.maxAttempts ?? 3,
                error: errMsg(error),
            };
            if (!cancelled) {
                this.logger.error(`Transfer failed for ${op.path} (${op.direction}): ${errMsg(error)}`);
            }
        }
        finally {
            this.active.delete(op.path);
            this.running -= 1;
        }
        this.emitter.fire({
            type: 'settled',
            operation: op,
            result,
            pending: this.pending.length,
            active: this.active.size,
        });
        if (this.pending.length === 0 && this.active.size === 0) {
            const waiters = this.drainWaiters;
            this.drainWaiters = [];
            for (const w of waiters) {
                w();
            }
            this.emitter.fire({ type: 'drained', pending: 0, active: 0 });
        }
        this.pump();
    }
}
exports.SyncQueue = SyncQueue;
function errMsg(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=syncQueue.js.map