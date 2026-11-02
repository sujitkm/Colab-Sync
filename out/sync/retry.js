"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRetryable = isRetryable;
exports.computeDelay = computeDelay;
exports.withRetry = withRetry;
/**
 * Bounded retry with exponential backoff and jitter.
 *
 * Only transient failures (network resets, 5xx, 429, timeouts) are retried;
 * permanent failures (4xx auth/not-found, path-safety errors, cancellation)
 * surface immediately.
 */
const types_1 = require("../types");
const remoteFileSystem_1 = require("../remote/remoteFileSystem");
/** Classify whether an error is worth retrying. */
function isRetryable(error) {
    if (error instanceof types_1.CancelledError) {
        return false;
    }
    if (error instanceof remoteFileSystem_1.RemoteAuthError || error instanceof remoteFileSystem_1.RemoteNotFoundError) {
        return false;
    }
    if (error instanceof Error && error.name === 'PathSafetyError') {
        return false;
    }
    const code = error?.code;
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') {
        return false;
    }
    // Network errors, HTTP 5xx/429/408 (surfaced as RemoteTransientError),
    // and anything unrecognized: retry.
    return true;
}
function computeDelay(attempt, baseDelayMs, maxDelayMs) {
    const exp = baseDelayMs * Math.pow(2, attempt - 1);
    const jitter = Math.random() * baseDelayMs * 0.5;
    return Math.min(exp + jitter, maxDelayMs);
}
function sleep(ms, token) {
    return new Promise((resolve, reject) => {
        if (token?.cancelled) {
            reject(new types_1.CancelledError());
            return;
        }
        const timer = setTimeout(() => resolve(), ms);
        token?.onCancel(() => {
            clearTimeout(timer);
            reject(new types_1.CancelledError());
        });
    });
}
/** Run `fn` with bounded retry. Throws the last error when exhausted. */
async function withRetry(fn, options = {}) {
    const maxAttempts = options.maxAttempts ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 1000;
    const maxDelayMs = options.maxDelayMs ?? 15_000;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (options.token?.cancelled) {
            throw new types_1.CancelledError();
        }
        try {
            const value = await fn(attempt);
            return { value, attempts: attempt };
        }
        catch (error) {
            lastError = error;
            if (attempt >= maxAttempts || !isRetryable(error)) {
                throw error;
            }
            const delay = computeDelay(attempt, baseDelayMs, maxDelayMs);
            options.onRetry?.(attempt, error, delay);
            await sleep(delay, options.token);
        }
    }
    throw lastError;
}
//# sourceMappingURL=retry.js.map