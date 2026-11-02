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
exports.normalizeRelativePath = normalizeRelativePath;
exports.isSafeRelativePath = isSafeRelativePath;
exports.resolveContained = resolveContained;
exports.normalizeRemoteRoot = normalizeRemoteRoot;
exports.joinRemotePath = joinRemotePath;
exports.toRelativePath = toRelativePath;
exports.parentPath = parentPath;
exports.baseName = baseName;
/**
 * Path normalization and containment enforcement.
 *
 * Every path that enters the sync engine — from the local watcher, the remote
 * server, or the manifest — passes through here. The rules are deliberately
 * strict: synchronized paths are always workspace/remote-root relative,
 * POSIX-style, and may never escape their root.
 */
const path = __importStar(require("node:path"));
const types_1 = require("../types");
/**
 * Normalize a user/remote supplied path to a canonical relative POSIX path.
 *
 * - Converts backslashes to forward slashes.
 * - Resolves `.` and `..` segments.
 * - Rejects absolute paths, drive letters, null bytes, and any result that
 *   escapes the root (`..` remainder).
 *
 * @returns canonical relative path (no leading `./` or `/`).
 * @throws PathSafetyError when the path is unsafe.
 */
function normalizeRelativePath(input) {
    if (typeof input !== 'string' || input.length === 0) {
        throw new types_1.PathSafetyError('Path must be a non-empty string');
    }
    if (input.includes('\u0000')) {
        throw new types_1.PathSafetyError(`Path contains null byte: ${JSON.stringify(input)}`);
    }
    // Reject Windows drive-letter and UNC paths before slash conversion.
    if (/^[a-zA-Z]:[\\/]/.test(input) || input.startsWith('\\\\')) {
        throw new types_1.PathSafetyError(`Absolute path rejected: ${input}`);
    }
    const posixInput = input.replace(/\\/g, '/');
    if (posixInput.startsWith('/')) {
        throw new types_1.PathSafetyError(`Absolute path rejected: ${input}`);
    }
    const normalized = path.posix.normalize(posixInput);
    if (normalized === '..' ||
        normalized.startsWith('../') ||
        normalized.startsWith('/')) {
        throw new types_1.PathSafetyError(`Path escapes root: ${input}`);
    }
    if (normalized === '.') {
        throw new types_1.PathSafetyError('Path refers to the root itself');
    }
    return normalized;
}
/** Returns true when {@link normalizeRelativePath} accepts the input. */
function isSafeRelativePath(input) {
    try {
        normalizeRelativePath(input);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Resolve a relative path against a local root and verify containment.
 *
 * Ensures the resolved absolute path stays inside `root`.
 * Returns the absolute path.
 */
function resolveContained(root, relPath) {
    const rel = normalizeRelativePath(relPath);
    const absRoot = path.resolve(root);
    const abs = path.resolve(absRoot, rel);
    if (abs !== absRoot && !abs.startsWith(absRoot + path.sep)) {
        throw new types_1.PathSafetyError(`Path escapes workspace root: ${relPath}`);
    }
    return abs;
}
/**
 * Normalize and validate a remote root such as `/content/NSCLC_Project`.
 * Must be an absolute POSIX path without traversal.
 */
function normalizeRemoteRoot(input) {
    if (typeof input !== 'string' || input.length === 0) {
        throw new types_1.PathSafetyError('Remote root must be a non-empty string');
    }
    if (input.includes('\u0000')) {
        throw new types_1.PathSafetyError('Remote root contains null byte');
    }
    const posixInput = input.replace(/\\/g, '/');
    if (!posixInput.startsWith('/')) {
        throw new types_1.PathSafetyError(`Remote root must be absolute: ${input}`);
    }
    // Reject traversal in the raw input before normalization hides it.
    if (posixInput.split('/').includes('..')) {
        throw new types_1.PathSafetyError(`Remote root contains traversal: ${input}`);
    }
    const normalized = path.posix
        .normalize(posixInput)
        .replace(/\/+$/, '');
    if (normalized === '/' || normalized === '.' || normalized === '') {
        throw new types_1.PathSafetyError('Remote root may not be the filesystem root');
    }
    return normalized;
}
/**
 * Join a validated remote root with a relative path, verifying the result
 * stays inside the root.
 */
function joinRemotePath(remoteRoot, relPath) {
    const root = normalizeRemoteRoot(remoteRoot);
    const rel = normalizeRelativePath(relPath);
    const joined = path.posix.normalize(path.posix.join(root, rel));
    if (joined !== root && !joined.startsWith(root + '/')) {
        throw new types_1.PathSafetyError(`Remote path escapes root: ${relPath}`);
    }
    return joined;
}
/** Convert an absolute local path to a workspace-relative POSIX path. */
function toRelativePath(root, absolutePath) {
    const absRoot = path.resolve(root);
    const abs = path.resolve(absolutePath);
    if (abs !== absRoot && !abs.startsWith(absRoot + path.sep)) {
        throw new types_1.PathSafetyError(`Path is outside workspace: ${absolutePath}`);
    }
    const rel = path.relative(absRoot, abs);
    return rel.split(path.sep).join('/');
}
/** Parent directory of a relative POSIX path ('' for top-level). */
function parentPath(relPath) {
    const dir = path.posix.dirname(relPath);
    return dir === '.' ? '' : dir;
}
/** Final path segment. */
function baseName(relPath) {
    return path.posix.basename(relPath);
}
//# sourceMappingURL=pathSafety.js.map