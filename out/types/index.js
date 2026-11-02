"use strict";
/**
 * ColabSync core type definitions.
 *
 * This module is intentionally free of any `vscode` imports so the sync core
 * can be unit-tested in plain Node.js.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathSafetyError = exports.CancelledError = exports.BasicCancelToken = exports.NULL_LOGGER = exports.ConflictResolution = exports.MANIFEST_VERSION = exports.DEFAULT_PROJECT_CONFIG = exports.RuntimeState = exports.TransferDirection = exports.TransferState = exports.SyncFileState = void 0;
/** Synchronization state of a single file. */
var SyncFileState;
(function (SyncFileState) {
    SyncFileState["Unchanged"] = "UNCHANGED";
    SyncFileState["LocalChanged"] = "LOCAL_CHANGED";
    SyncFileState["RemoteChanged"] = "REMOTE_CHANGED";
    SyncFileState["Conflict"] = "CONFLICT";
    SyncFileState["LocalOnly"] = "LOCAL_ONLY";
    SyncFileState["RemoteOnly"] = "REMOTE_ONLY";
    SyncFileState["LocalDeleted"] = "LOCAL_DELETED";
    SyncFileState["RemoteDeleted"] = "REMOTE_DELETED";
    SyncFileState["Failed"] = "FAILED";
    SyncFileState["Ignored"] = "IGNORED";
    SyncFileState["Syncing"] = "SYNCING";
})(SyncFileState || (exports.SyncFileState = SyncFileState = {}));
/** Lifecycle state of a single queued transfer. */
var TransferState;
(function (TransferState) {
    TransferState["Pending"] = "PENDING";
    TransferState["Uploading"] = "UPLOADING";
    TransferState["Downloading"] = "DOWNLOADING";
    TransferState["Completed"] = "COMPLETED";
    TransferState["Failed"] = "FAILED";
    TransferState["Conflict"] = "CONFLICT";
    TransferState["Cancelled"] = "CANCELLED";
})(TransferState || (exports.TransferState = TransferState = {}));
/** Direction of a transfer. */
var TransferDirection;
(function (TransferDirection) {
    TransferDirection["Upload"] = "UPLOAD";
    TransferDirection["Download"] = "DOWNLOAD";
    TransferDirection["DeleteLocal"] = "DELETE_LOCAL";
    TransferDirection["DeleteRemote"] = "DELETE_REMOTE";
})(TransferDirection || (exports.TransferDirection = TransferDirection = {}));
/** High-level runtime connection state. */
var RuntimeState;
(function (RuntimeState) {
    RuntimeState["Disconnected"] = "DISCONNECTED";
    RuntimeState["Connecting"] = "CONNECTING";
    RuntimeState["Connected"] = "CONNECTED";
    RuntimeState["Syncing"] = "SYNCING";
    RuntimeState["Conflict"] = "CONFLICT";
    RuntimeState["Error"] = "ERROR";
})(RuntimeState || (exports.RuntimeState = RuntimeState = {}));
/** Default project configuration. */
exports.DEFAULT_PROJECT_CONFIG = {
    remoteRoot: '/content/project',
    autoSync: true,
    pollInterval: 10,
    deleteSync: false,
    include: ['**/*'],
    exclude: [
        '.git/**',
        '.venv/**',
        'node_modules/**',
        '__pycache__/**',
        '.Rproj.user/**',
        '.colabsync/**',
        '*.tmp',
        '*.log',
    ],
    maxFileSize: 500 * 1024 * 1024,
    transferConcurrency: 3,
};
exports.MANIFEST_VERSION = 1;
/** How a conflict was (or should be) resolved. */
var ConflictResolution;
(function (ConflictResolution) {
    ConflictResolution["KeepLocal"] = "KEEP_LOCAL";
    ConflictResolution["KeepRemote"] = "KEEP_REMOTE";
    ConflictResolution["Cancel"] = "CANCEL";
})(ConflictResolution || (exports.ConflictResolution = ConflictResolution = {}));
/** A no-op logger used as default in tests. */
exports.NULL_LOGGER = {
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
};
/** Simple mutable cancel token. */
class BasicCancelToken {
    listeners = [];
    _cancelled = false;
    get cancelled() {
        return this._cancelled;
    }
    cancel() {
        if (this._cancelled) {
            return;
        }
        this._cancelled = true;
        for (const l of this.listeners) {
            l();
        }
        this.listeners = [];
    }
    onCancel(listener) {
        if (this._cancelled) {
            listener();
            return;
        }
        this.listeners.push(listener);
    }
}
exports.BasicCancelToken = BasicCancelToken;
/** Error thrown when an operation is cancelled by the user. */
class CancelledError extends Error {
    constructor(message = 'Operation cancelled') {
        super(message);
        this.name = 'CancelledError';
    }
}
exports.CancelledError = CancelledError;
/** Error thrown for path-safety violations. */
class PathSafetyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PathSafetyError';
    }
}
exports.PathSafetyError = PathSafetyError;
//# sourceMappingURL=index.js.map