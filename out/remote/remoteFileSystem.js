"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteTransientError = exports.RemoteAuthError = exports.RemoteNotFoundError = void 0;
/** Error thrown when a remote path does not exist. */
class RemoteNotFoundError extends Error {
    path;
    constructor(message, path) {
        super(message);
        this.path = path;
        this.name = 'RemoteNotFoundError';
    }
}
exports.RemoteNotFoundError = RemoteNotFoundError;
/** Error thrown when the remote endpoint rejects authentication. */
class RemoteAuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RemoteAuthError';
    }
}
exports.RemoteAuthError = RemoteAuthError;
/** Error thrown for transient remote failures eligible for retry. */
class RemoteTransientError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RemoteTransientError';
    }
}
exports.RemoteTransientError = RemoteTransientError;
//# sourceMappingURL=remoteFileSystem.js.map