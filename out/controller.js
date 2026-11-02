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
exports.ColabSyncController = void 0;
/**
 * ColabSync controller — wires the vscode-free sync core to the VS Code UI.
 *
 * Owns: configuration, manifest, engine, connection manager, watchers,
 * status bar, tree view, and all command implementations. Commands stay
 * thin; behavior lives here.
 */
const vscode = __importStar(require("vscode"));
const path = __importStar(require("node:path"));
const types_1 = require("./types");
const configuration_1 = require("./config/configuration");
const localFileSystem_1 = require("./filesystem/localFileSystem");
const localWatcher_1 = require("./filesystem/localWatcher");
const manifest_1 = require("./sync/manifest");
const syncEngine_1 = require("./sync/syncEngine");
const remoteWatcher_1 = require("./sync/remoteWatcher");
const conflictResolver_1 = require("./sync/conflictResolver");
const connection_1 = require("./colab/connection");
const statusBar_1 = require("./ui/statusBar");
const treeView_1 = require("./ui/treeView");
const notifications_1 = require("./ui/notifications");
const notebookSync_1 = require("./notebook/notebookSync");
class ColabSyncController {
    logger;
    statusBar = new statusBar_1.StatusBar();
    treeProvider = new treeView_1.ColabSyncTreeProvider();
    connection;
    notebookTrigger;
    config = null;
    engine = null;
    manifest = null;
    localWatcher = null;
    remoteWatcher = null;
    conflictResolver = null;
    syncing = false;
    disposables = [];
    constructor(context, logger) {
        this.context = context;
        this.logger = logger;
        this.connection = new connection_1.ConnectionManager(context, logger);
        this.notebookTrigger = new notebookSync_1.NotebookSyncTrigger(logger, () => {
            if (this.config?.autoSync && this.engine?.isRemoteAttached) {
                void this.runSync('both', { quiet: true });
            }
        });
        this.disposables.push(this.statusBar, this.treeProvider, this.connection, this.notebookTrigger);
        this.disposables.push(vscode.window.registerTreeDataProvider('colabsync.statusView', this.treeProvider));
        this.connection.event((e) => {
            this.updateUi();
            // ConnectionManager errors are surfaced by the command/reconnect
            // handlers below so one failure does not produce duplicate toasts.
            if (e.state === types_1.RuntimeState.Error && e.message) {
            }
        });
    }
    /** Called on activation: restore project state when a config exists. */
    async initialize() {
        const folder = this.workspaceFolder();
        if (!folder) {
            this.logger.info('No workspace folder open; Colab Sync is idle');
            this.updateUi();
            return;
        }
        try {
            const created = await this.ensureProjectConfig(folder);
            await this.setupEngine(folder);
            this.logger.info(created ? `Auto-created project configuration for ${folder.uri.fsPath}` : 'Project configuration loaded');
        }
        catch (error) {
            this.logger.error('Failed to load project configuration', error);
            void vscode.window.showErrorMessage(`Colab Sync: ${error.message}`);
        }
        this.updateUi();
    }
    // -------------------------------------------------------------- commands
    /** ColabSync: Initialize Project */
    async initializeProject() {
        const folder = this.requireWorkspace();
        if (!folder) {
            return;
        }
        if (await (0, configuration_1.configExists)(folder.uri.fsPath)) {
            const choice = await vscode.window.showWarningMessage('This project already has a .colabsync/config.json. Overwrite it?', 'Overwrite', 'Cancel');
            if (choice !== 'Overwrite') {
                return;
            }
        }
        const folderName = path.basename(folder.uri.fsPath);
        const remoteRoot = `/content/${folderName}`;
        const vsDefaults = vscode.workspace.getConfiguration('colabsync');
        const config = {
            ...types_1.DEFAULT_PROJECT_CONFIG,
            remoteRoot,
            autoSync: vsDefaults.get('autoSync', types_1.DEFAULT_PROJECT_CONFIG.autoSync),
            pollInterval: vsDefaults.get('pollInterval', types_1.DEFAULT_PROJECT_CONFIG.pollInterval),
            transferConcurrency: vsDefaults.get('transferConcurrency', types_1.DEFAULT_PROJECT_CONFIG.transferConcurrency),
            maxFileSize: vsDefaults.get('maxFileSize', types_1.DEFAULT_PROJECT_CONFIG.maxFileSize),
        };
        await (0, configuration_1.saveConfig)(folder.uri.fsPath, config);
        await this.setupEngine(folder);
        this.logger.info(`Initialized project from local workspace ${folder.uri.fsPath}; remote root auto-mapped to ${remoteRoot}`);
        const choice = await vscode.window.showInformationMessage(`Project initialized. Local: ${folder.uri.fsPath} → Remote: ${remoteRoot}. Connect to a runtime now?`, 'Connect', 'Later');
        if (choice === 'Connect') {
            await this.connect();
        }
        this.updateUi();
    }
    /** ColabSync: Connect */
    async connect() {
        const folder = this.requireWorkspace();
        if (!folder) {
            return;
        }
        await this.ensureProjectConfig(folder);
        await this.ensureAutoProjectRoot(folder);
        if (!this.engine) {
            await this.setupEngine(folder);
        }
        const engine = await this.requireEngine();
        if (!engine) {
            return;
        }
        const config = this.requireConfig();
        try {
            const info = await this.connection.connect(config);
            if (!info) {
                return;
            }
            engine.setRemote(info.remoteFs);
            this.startWatchers();
            if (info.kind === 'colab' && !(await this.isBootstrapCompleted(folder))) {
                this.logger.info('Initial synchronization mode: LOCAL -> REMOTE bootstrap');
                await engine.bootstrapLocalToRemote();
                await this.markBootstrapCompleted(folder, info.runtimeName);
                // Bootstrap already uploaded local files and seeded the manifest.
                // Do not immediately run a second three-way sync: Colab/Jupyter
                // metadata (especially mtimes) can differ from the local view and
                // cause false conflicts immediately after connect.
                engine.clearConflicts?.();
                this.logger.info('Initial bootstrap complete; skipping redundant post-bootstrap three-way sync');
            }
            else {
                await this.runSync('both', { quiet: false });
            }
        }
        catch (error) {
            this.logger.error('Connect failed', error);
            void vscode.window.showErrorMessage(`Colab Sync connect failed: ${error.message}`);
        }
        this.updateUi();
    }
    /** ColabSync: Disconnect */
    async disconnect() {
        this.stopWatchers();
        this.engine?.setRemote(null);
        await this.connection.disconnect();
        this.updateUi();
    }
    /** ColabSync: Reconnect Runtime */
    async reconnect() {
        const engine = await this.requireEngine();
        if (!engine) {
            return;
        }
        const config = this.requireConfig();
        try {
            const info = await this.connection.reconnect(config);
            if (!info) {
                return;
            }
            engine.setRemote(info.remoteFs);
            this.startWatchers();
            // Reconcile: remote may have been recycled -> engine rebuilds safely.
            await this.runSync('both', { quiet: false });
        }
        catch (error) {
            this.logger.error('Reconnect failed', error);
            void vscode.window.showErrorMessage(`Colab Sync reconnect failed: ${error.message}`);
        }
        this.updateUi();
    }
    /** ColabSync: Sync Now */
    async syncNow() {
        await this.runSync('both', { quiet: false });
    }
    /** ColabSync: Push Local Changes */
    async push() {
        await this.runSync('push', { quiet: false });
    }
    /** ColabSync: Pull Remote Changes */
    async pull() {
        await this.runSync('pull', { quiet: false });
    }
    /** ColabSync: Resolve Conflicts */
    async resolveConflicts() {
        const engine = this.engine;
        const resolver = this.conflictResolver;
        if (!engine || !resolver || !engine.isRemoteAttached) {
            void vscode.window.showInformationMessage('Colab Sync: connect to a runtime first.');
            return;
        }
        const conflicts = [...engine.currentConflicts];
        if (conflicts.length === 0) {
            void vscode.window.showInformationMessage('Colab Sync: no conflicts.');
            return;
        }
        for (const conflict of conflicts) {
            const remote = engine.remoteFs;
            if (!remote) {
                break;
            }
            const choice = await resolver.resolve(conflict, remote);
            if (choice === 'cancel') {
                continue;
            }
            await engine.resolveConflict(conflict, choice);
            this.logger.info(`Conflict resolved for ${conflict.path}: kept ${choice}`);
        }
        this.updateUi();
    }
    /** ColabSync: Show Status (status bar click menu) */
    async showStatus() {
        const connected = this.connection.getState() === types_1.RuntimeState.Connected;
        const items = [];
        if (!connected) {
            items.push({
                label: '$(plug) Connect',
                run: () => this.connect(),
            });
        }
        else {
            items.push({ label: '$(sync) Sync Now', run: () => this.syncNow() }, { label: '$(cloud-upload) Push Local Changes', run: () => this.push() }, { label: '$(cloud-download) Pull Remote Changes', run: () => this.pull() }, {
                label: '$(warning) Resolve Conflicts',
                run: () => this.resolveConflicts(),
            }, {
                label: '$(debug-restart) Reconnect Runtime',
                run: () => this.reconnect(),
            }, { label: '$(debug-disconnect) Disconnect', run: () => this.disconnect() });
        }
        items.push({
            label: '$(gear) Open Project Settings',
            run: () => this.openSettings(),
        }, {
            label: '$(output) Show Logs',
            run: () => {
                this.logger.show?.();
            },
        });
        const pick = await vscode.window.showQuickPick(items, {
            title: `Colab Sync: ${this.statusText()}`,
            placeHolder: 'Choose an action',
        });
        await pick?.run?.();
    }
    /** ColabSync: Settings — opens .colabsync/config.json for editing. */
    async openSettings() {
        const folder = this.workspaceFolder();
        if (!folder) {
            return;
        }
        if (!(await (0, configuration_1.configExists)(folder.uri.fsPath))) {
            const choice = await vscode.window.showInformationMessage('No Colab Sync project yet. Initialize one first?', 'Initialize Project');
            if (choice === 'Initialize Project') {
                await this.initializeProject();
            }
            return;
        }
        const doc = await vscode.workspace.openTextDocument(path.join(folder.uri.fsPath, '.colabsync', 'config.json'));
        await vscode.window.showTextDocument(doc);
    }
    // --------------------------------------------------------------- intern
    async runSync(direction, opts) {
        const engine = await this.requireEngine();
        if (!engine || !engine.isRemoteAttached) {
            if (!opts.quiet) {
                void vscode.window.showInformationMessage('Colab Sync: connect to a runtime first.');
            }
            return;
        }
        if (this.syncing) {
            this.logger.debug('Sync already in progress; skipping re-entrant run');
            return;
        }
        this.syncing = true;
        this.updateUi();
        try {
            const summary = await engine.sync(direction);
            this.logger.info(`Sync (${direction}) completed in ${summary.durationMs}ms: ` +
                `${summary.results.length} transfer(s), ${summary.plan.conflicts.length} conflict(s)`);
            if (summary.plan.remoteLost) {
                void (0, notifications_1.notifyRuntimeRebuilt)();
            }
            if (!opts.quiet || summary.plan.conflicts.length > 0) {
                void (0, notifications_1.notifySyncComplete)(summary);
            }
        }
        catch (error) {
            this.logger.error('Sync failed', error);
            void vscode.window.showErrorMessage(`Colab Sync sync failed: ${error.message}`);
        }
        finally {
            this.syncing = false;
            this.updateUi();
        }
    }
    async ensureProjectConfig(folder) {
        if (await (0, configuration_1.configExists)(folder.uri.fsPath)) {
            return false;
        }
        const folderName = path.basename(folder.uri.fsPath);
        const vsDefaults = vscode.workspace.getConfiguration('colabsync');
        const config = {
            ...types_1.DEFAULT_PROJECT_CONFIG,
            remoteRoot: `/content/${folderName}`,
            autoSync: vsDefaults.get('autoSync', types_1.DEFAULT_PROJECT_CONFIG.autoSync),
            pollInterval: vsDefaults.get('pollInterval', types_1.DEFAULT_PROJECT_CONFIG.pollInterval),
            transferConcurrency: vsDefaults.get('transferConcurrency', types_1.DEFAULT_PROJECT_CONFIG.transferConcurrency),
            maxFileSize: vsDefaults.get('maxFileSize', types_1.DEFAULT_PROJECT_CONFIG.maxFileSize),
        };
        await (0, configuration_1.saveConfig)(folder.uri.fsPath, config);
        return true;
    }
    async isBootstrapCompleted(folder) {
        return this.context.workspaceState.get(`colabsync.bootstrap.v2:${folder.uri.fsPath}`) === true;
    }
    async markBootstrapCompleted(folder, runtimeName) {
        await this.context.workspaceState.update(`colabsync.bootstrap.v2:${folder.uri.fsPath}`, true);
        if (runtimeName) {
            await this.context.workspaceState.update(`colabsync.bootstrap.runtime.v2:${folder.uri.fsPath}`, runtimeName);
        }
    }
    async ensureAutoProjectRoot(folder) {
        if (!this.config) {
            return;
        }
        const folderName = path.basename(folder.uri.fsPath);
        const autoRoot = `/content/${folderName}`;
        if (this.config.remoteRoot === autoRoot) {
            return;
        }
        const previousRoot = this.config.remoteRoot;
        this.logger.info(`Auto-detected Colab project root: ${autoRoot} (was ${previousRoot})`);
        const config = { ...this.config, remoteRoot: autoRoot };
        await (0, configuration_1.saveConfig)(folder.uri.fsPath, config);
        // A manifest tied to a different remote root cannot safely be reused.
        // Keep a backup and start a fresh manifest; local files remain intact.
        const manifestPath = path.join(folder.uri.fsPath, '.colabsync', 'manifest.json');
        try {
            const backup = `${manifestPath}.rootchange-${Date.now()}.bak`;
            await require('node:fs/promises').rename(manifestPath, backup);
            this.logger.info(`Backed up old manifest to ${path.basename(backup)}`);
        }
        catch (error) {
            if (error?.code !== 'ENOENT') {
                throw error;
            }
        }
        this.config = config;
        await this.setupEngine(folder);
    }
    async setupEngine(folder) {
        let config = await (0, configuration_1.loadConfig)(folder.uri.fsPath);
        if (!config) {
            throw new configuration_1.ConfigError('No configuration found after initialization');
        }
        // ColabSync 1.0.18 and earlier generated a 30s polling default.
        // Migrate that legacy default to the new 10s default when the current
        // VS Code setting is also the new 10s default. This avoids overriding
        // an explicit user preference such as 30s.
        const configuredPollInterval = vscode.workspace.getConfiguration('colabsync').get('pollInterval', types_1.DEFAULT_PROJECT_CONFIG.pollInterval);
        if (config.pollInterval === 30 && configuredPollInterval === 10) {
            config = { ...config, pollInterval: 10 };
            await (0, configuration_1.saveConfig)(folder.uri.fsPath, config);
            this.logger.info('Migrated legacy project polling interval from 30s to 10s');
        }
        this.config = config;
        const localFs = new localFileSystem_1.LocalFileSystem(folder.uri.fsPath);
        this.manifest = await manifest_1.ManifestStore.load(folder.uri.fsPath, config.remoteRoot);
        this.engine = new syncEngine_1.SyncEngine({
            localFs,
            manifest: this.manifest,
            config,
            logger: this.logger,
        });
        this.conflictResolver = new conflictResolver_1.ConflictResolver(folder.uri);
        this.engine.event((e) => {
            if (e.type === 'conflicts' && e.conflicts) {
                void (0, notifications_1.notifyConflicts)(e.conflicts);
            }
            if (e.type === 'settled' || e.type === 'synced' || e.type === 'plan') {
                this.updateUi();
            }
        });
    }
    startWatchers() {
        const folder = this.workspaceFolder();
        const config = this.config;
        const engine = this.engine;
        if (!folder || !config || !engine) {
            return;
        }
        this.stopWatchers();
        this.localWatcher = new localWatcher_1.LocalWatcher(folder, this.logger, (events) => {
            if (!this.config?.autoSync) {
                return;
            }
            const rescanRoots = events
                .filter((ev) => ev.kind === 'rescan')
                .map((ev) => ev.relPath);
            const isCoveredByRescan = (relPath) => rescanRoots.some((root) => relPath === root || relPath.startsWith(`${root}/`));
            for (const ev of events) {
                if (ev.kind === 'rescan') {
                    continue;
                }
                // A directory rescan will see every child file, so skip
                // individual child events covered by that rescan. This avoids
                // duplicate uploads when a folder paste generates many events.
                if (isCoveredByRescan(ev.relPath)) {
                    continue;
                }
                void this.engine
                    ?.handleLocalEvent(ev.relPath, ev.kind)
                    .catch((error) => this.logger.warn(`Local event handling failed for ${ev.relPath}`, error))
                    .finally(() => this.updateUi());
            }
            if (rescanRoots.length > 0) {
                // The watcher collapses a directory-create event into a rescan
                // event. Materialize each rescan root first so an empty local
                // folder is still represented remotely; then the normal sync
                // pass uploads any files discovered underneath it.
                for (const root of rescanRoots) {
                    void this.engine
                        ?.handleLocalEvent(root, 'created')
                        .catch((error) => this.logger.warn(`Local directory creation sync failed for ${root}: ${error.message}`))
                        .finally(() => this.updateUi());
                }
                void this.runSync('both', { quiet: true })
                    .catch((error) => this.logger.warn(`Local directory rescan failed: ${error.message}`))
                    .finally(() => this.updateUi());
            }
        });
        this.localWatcher.start();
        this.remoteWatcher = new remoteWatcher_1.RemoteWatcher(this.logger, async () => {
            if (this.config?.autoSync) {
                await this.runSync('both', { quiet: true });
            }
        });
        this.remoteWatcher.start(config.pollInterval);
    }
    stopWatchers() {
        this.localWatcher?.dispose();
        this.localWatcher = null;
        this.remoteWatcher?.stop();
        this.remoteWatcher = null;
    }
    updateUi() {
        const connState = this.connection.getState();
        const conflicts = this.engine?.currentConflicts.length ?? 0;
        let state = connState;
        if (this.syncing) {
            state = types_1.RuntimeState.Syncing;
        }
        else if (conflicts > 0) {
            state = types_1.RuntimeState.Conflict;
        }
        this.statusBar.setState(state, conflicts);
        const manifest = this.manifest;
        this.treeProvider.update({
            state,
            runtimeLabel: this.connection.getCurrent()?.runtimeLabel ?? 'Not connected',
            remoteRoot: this.config?.remoteRoot ?? '',
            pendingUploads: this.engine?.transferQueue.pendingUploads().length ?? 0,
            pendingDownloads: this.engine?.transferQueue.pendingDownloads().length ?? 0,
            conflicts: this.engine?.currentConflicts ?? [],
            syncedFiles: manifest
                ? manifest.pathsInState(types_1.SyncFileState.Unchanged).length
                : 0,
        });
    }
    statusText() {
        switch (this.connection.getState()) {
            case types_1.RuntimeState.Connected:
                return 'Connected';
            case types_1.RuntimeState.Connecting:
                return 'Connecting...';
            default:
                return 'Disconnected';
        }
    }
    workspaceFolder() {
        const folders = vscode.workspace.workspaceFolders;
        const activeNotebook = vscode.window.activeNotebookEditor?.notebook?.uri;
        if (folders && folders.length > 0 && activeNotebook?.scheme === 'file') {
            const matching = folders.find((folder) => isPathInside(folder.uri.fsPath, activeNotebook.fsPath));
            if (matching) {
                return matching;
            }
        }
        if (folders && folders.length > 0) {
            return folders[0];
        }
        if (activeNotebook?.scheme === 'file') {
            const dir = path.dirname(activeNotebook.fsPath);
            return { uri: vscode.Uri.file(dir), name: path.basename(dir), index: 0 };
        }
        return undefined;
    }
    requireWorkspace() {
        const folder = this.workspaceFolder();
        if (!folder) {
            void vscode.window.showWarningMessage('Colab Sync: open a project folder or an .ipynb notebook first.');
        }
        return folder;
    }
    requireConfig() {
        if (!this.config) {
            throw new Error('No Colab Sync project configuration loaded');
        }
        return this.config;
    }
    async requireEngine() {
        if (this.engine) {
            return this.engine;
        }
        const folder = this.workspaceFolder();
        if (!folder) {
            void vscode.window.showWarningMessage('Colab Sync: open a project folder first.');
            return null;
        }
        const choice = await vscode.window.showInformationMessage('Colab Sync: this folder is not initialized yet.', 'Initialize Project');
        if (choice === 'Initialize Project') {
            await this.initializeProject();
            return this.engine;
        }
        return null;
    }
    dispose() {
        this.stopWatchers();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
exports.ColabSyncController = ColabSyncController;
//# sourceMappingURL=controller.js.map
function isPathInside(root, target) {
    try {
        const absRoot = path.resolve(root);
        const absTarget = path.resolve(target);
        return absTarget === absRoot || absTarget.startsWith(absRoot + path.sep);
    }
    catch {
        return false;
    }
}
