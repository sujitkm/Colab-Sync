"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || (!desc.enumerable && !desc.configurable)) desc = { enumerable: true, get: function() { return m[k]; } };
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; }));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) { o["default"] = v; });
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = []; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[k] = o[k]; return ar;
        }; return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod); return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalWatcher = void 0;
const vscode = __importStar(require("vscode"));
const fsp = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const pathSafety_1 = require("./pathSafety");
const DEBOUNCE_MS = 500;
const DIRECTORY_POLL_MS = 1500;
class LocalWatcher {
    workspaceFolder;
    logger;
    onEvents;
    watcher = null;
    pendingEvents = new Map();
    debounceTimer = null;
    directoryTimer = null;
    disposables = [];
    active = false;
    knownDirectories = new Set();
    constructor(workspaceFolder, logger, onEvents) {
        this.workspaceFolder = workspaceFolder;
        this.logger = logger;
        this.onEvents = onEvents;
    }
    start() {
        this.stop();
        this.active = true;
        const pattern = new vscode.RelativePattern(this.workspaceFolder, '**/*');
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.disposables.push(this.watcher, this.watcher.onDidCreate((uri) => this.record(uri, 'created')), this.watcher.onDidChange((uri) => this.record(uri, 'changed')), this.watcher.onDidDelete((uri) => this.record(uri, 'deleted')));
        this.logger.debug('Local file watcher started');
        void this.seedDirectoriesAndStartPolling();
    }
    stop() {
        this.active = false;
        for (const d of this.disposables) d.dispose();
        this.disposables.length = 0;
        this.watcher = null;
        if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
        if (this.directoryTimer !== null) clearTimeout(this.directoryTimer);
        this.directoryTimer = null;
        this.pendingEvents.clear();
        this.knownDirectories.clear();
    }
    dispose() { this.stop(); }
    record(uri, kind) {
        if (uri.scheme !== 'file') return;
        let relPath;
        try {
            relPath = (0, pathSafety_1.toRelativePath)(this.workspaceFolder.uri.fsPath, uri.fsPath);
            if (!(0, pathSafety_1.isSafeRelativePath)(relPath)) return;
        } catch { return; }
        // Notebook files are handled specially by the controller while a
        // notebook is executing. Ordinary file events stay targeted.
        const existing = this.pendingEvents.get(relPath);
        if (existing === 'deleted' && kind !== 'deleted') this.pendingEvents.set(relPath, 'changed');
        else if (!existing || kind === 'deleted') this.pendingEvents.set(relPath, kind);
        this.scheduleFlush();
    }
    scheduleFlush() {
        if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            const events = [...this.pendingEvents.entries()].map(([p, k]) => ({ relPath: p, kind: k }));
            this.pendingEvents.clear();
            if (events.length > 0) this.onEvents(events);
        }, DEBOUNCE_MS);
    }
    async seedDirectoriesAndStartPolling() {
        try {
            this.knownDirectories = await this.scanDirectories();
        } catch (error) {
            this.logger.debug?.(`Initial local directory scan skipped: ${error?.message ?? String(error)}`);
            this.knownDirectories = new Set();
        }
        if (this.active) this.scheduleDirectoryPoll();
    }
    scheduleDirectoryPoll() {
        if (this.directoryTimer !== null) clearTimeout(this.directoryTimer);
        this.directoryTimer = setTimeout(() => {
            this.directoryTimer = null;
            void this.pollDirectories();
        }, DIRECTORY_POLL_MS);
    }
    async pollDirectories() {
        if (!this.active) return;
        try {
            const current = await this.scanDirectories();
            for (const rel of current) {
                if (!this.knownDirectories.has(rel)) {
                    this.pendingEvents.set(rel, 'created');
                    this.logger.debug(`Local directory discovered: ${rel}`);
                }
            }
            // Keep the baseline current; deletions are still handled by the
            // filesystem watcher because a full directory delete can be large.
            this.knownDirectories = current;
            if (this.pendingEvents.size > 0) this.scheduleFlush();
        } catch (error) {
            this.logger.debug?.(`Local directory poll skipped: ${error?.message ?? String(error)}`);
        } finally {
            if (this.active) this.scheduleDirectoryPoll();
        }
    }
    async scanDirectories() {
        const root = this.workspaceFolder.uri.fsPath;
        const found = new Set();
        const stack = [root];
        while (stack.length > 0) {
            const dir = stack.pop();
            let entries;
            try {
                entries = await fsp.readdir(dir, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
                const full = path.join(dir, entry.name);
                if (full === root) continue;
                let rel;
                try {
                    rel = (0, pathSafety_1.toRelativePath)(root, full);
                } catch {
                    continue;
                }
                if (!(0, pathSafety_1.isSafeRelativePath)(rel)) continue;
                found.add(rel);
                stack.push(full);
            }
        }
        return found;
    }
}
exports.LocalWatcher = LocalWatcher;
//# sourceMappingURL=localWatcher.js.map
