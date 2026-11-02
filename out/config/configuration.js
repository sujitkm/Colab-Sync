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
exports.ConfigError = exports.CONFIG_FILE = exports.CONFIG_DIR = void 0;
exports.configPath = configPath;
exports.configExists = configExists;
exports.validateConfig = validateConfig;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
/**
 * Project configuration management (`.colabsync/config.json`).
 *
 * The config file is user-editable project metadata. It must never contain
 * credentials — validation actively rejects keys that look like secrets.
 * Global VS Code settings (`colabsync.*`) provide defaults when a project
 * config is first created.
 */
const fsp = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const types_1 = require("../types");
const pathSafety_1 = require("../filesystem/pathSafety");
const types_2 = require("../types");
exports.CONFIG_DIR = '.colabsync';
exports.CONFIG_FILE = 'config.json';
/** Keys that may never appear in the project config. */
const FORBIDDEN_KEYS = new Set([
    'token',
    'password',
    'secret',
    'accessToken',
    'refreshToken',
    'apiKey',
    'credentials',
    'cookie',
    'cookies',
    'authorization',
]);
class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigError';
    }
}
exports.ConfigError = ConfigError;
function configPath(workspaceRoot) {
    return path.join(workspaceRoot, exports.CONFIG_DIR, exports.CONFIG_FILE);
}
async function configExists(workspaceRoot) {
    try {
        await fsp.stat(configPath(workspaceRoot));
        return true;
    }
    catch {
        return false;
    }
}
/** Validate an unknown object into a ProjectConfig, applying defaults. */
function validateConfig(raw) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ConfigError('Configuration must be a JSON object');
    }
    const obj = raw;
    for (const key of Object.keys(obj)) {
        if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
            throw new ConfigError(`Configuration key "${key}" is forbidden: never store credentials in ${exports.CONFIG_FILE}`);
        }
    }
    const cfg = { ...types_1.DEFAULT_PROJECT_CONFIG };
    if (obj.remoteRoot !== undefined) {
        if (typeof obj.remoteRoot !== 'string') {
            throw new ConfigError('remoteRoot must be a string');
        }
        try {
            cfg.remoteRoot = (0, pathSafety_1.normalizeRemoteRoot)(obj.remoteRoot);
        }
        catch (err) {
            const message = err instanceof types_2.PathSafetyError ? err.message : String(err);
            throw new ConfigError(`Invalid remoteRoot: ${message}`);
        }
    }
    if (obj.autoSync !== undefined) {
        cfg.autoSync = expectBoolean(obj.autoSync, 'autoSync');
    }
    if (obj.pollInterval !== undefined) {
        cfg.pollInterval = expectNumber(obj.pollInterval, 'pollInterval', 0, 86400);
    }
    if (obj.deleteSync !== undefined) {
        cfg.deleteSync = expectBoolean(obj.deleteSync, 'deleteSync');
    }
    if (obj.include !== undefined) {
        cfg.include = expectStringArray(obj.include, 'include');
    }
    if (obj.exclude !== undefined) {
        cfg.exclude = expectStringArray(obj.exclude, 'exclude');
    }
    if (obj.maxFileSize !== undefined) {
        cfg.maxFileSize = expectNumber(obj.maxFileSize, 'maxFileSize', 1);
    }
    if (obj.transferConcurrency !== undefined) {
        cfg.transferConcurrency = expectNumber(obj.transferConcurrency, 'transferConcurrency', 1, 16);
    }
    return cfg;
}
/** Load and validate the project config. Returns null when absent. */
async function loadConfig(workspaceRoot) {
    let raw;
    try {
        raw = await fsp.readFile(configPath(workspaceRoot), 'utf-8');
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        throw new ConfigError(`${exports.CONFIG_FILE} is not valid JSON: ${err.message}`);
    }
    return validateConfig(parsed);
}
/** Persist the config (pretty-printed, stable key order). */
async function saveConfig(workspaceRoot, config) {
    await fsp.mkdir(path.join(workspaceRoot, exports.CONFIG_DIR), { recursive: true });
    const ordered = {
        remoteRoot: config.remoteRoot,
        autoSync: config.autoSync,
        pollInterval: config.pollInterval,
        deleteSync: config.deleteSync,
        include: config.include,
        exclude: config.exclude,
        maxFileSize: config.maxFileSize,
        transferConcurrency: config.transferConcurrency,
    };
    await fsp.writeFile(configPath(workspaceRoot), JSON.stringify(ordered, null, 2) + '\n', 'utf-8');
}
function expectBoolean(value, key) {
    if (typeof value !== 'boolean') {
        throw new ConfigError(`${key} must be a boolean`);
    }
    return value;
}
function expectNumber(value, key, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ConfigError(`${key} must be a finite number`);
    }
    if (value < min || (max !== undefined && value > max)) {
        throw new ConfigError(`${key} must be between ${min} and ${max ?? 'infinity'}`);
    }
    return value;
}
function expectStringArray(value, key) {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
        throw new ConfigError(`${key} must be an array of strings`);
    }
    return value;
}
//# sourceMappingURL=configuration.js.map