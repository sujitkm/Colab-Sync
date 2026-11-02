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
exports.ConnectionManager = void 0;
/**
 * Connection manager: establishes, verifies, and tears down the link between
 * the local workspace and a remote runtime.
 *
 * Responsibilities:
 *   - connect via companion auth (official Colab extension) or manual
 *     Jupyter URL+token
 *   - assign / reattach to a Colab runtime
 *   - verify (and if needed create) the remote project directory
 *   - detect runtime loss and reassign on reconnect
 *   - never touch local files: disconnect is always safe
 *
 * The manager produces a ready-to-use RemoteFileSystem; the sync engine
 * consumes it.
 */
const vscode = __importStar(require("vscode"));
const types_1 = require("../types");
const emitter_1 = require("../util/emitter");
const colabKernelFileSystem_1 = require("../remote/colabKernelFileSystem");
const jupyterContentsFileSystem_1 = require("../remote/jupyterContentsFileSystem");
const authentication_1 = require("./authentication");
const colabApiClient_1 = require("./colabApiClient");
const STATE_KEY = 'colabsync.lastConnection';
class ConnectionManager {
    context;
    logger;
    state = types_1.RuntimeState.Disconnected;
    current = null;
    connecting = null;
    emitter = new emitter_1.Emitter();
    event = this.emitter.event;
    constructor(context, logger) {
        this.context = context;
        this.logger = logger;
    }
    getState() {
        return this.state;
    }
    getCurrent() {
        return this.current;
    }
    dispose() {
        this.emitter.clear();
    }
    setState(state, message) {
        this.state = state;
        this.emitter.fire({ state, info: this.current ?? undefined, message });
    }
    /**
     * Interactive connect. Asks the user which method to use when the official
     * Colab extension is available; otherwise falls back to manual.
     */
    async connect(config) {
        // Reuse an already established connection even if a second Connect
        // command arrives after the notebook editor/focus has changed.
        if (this.current) {
            if (this.state !== types_1.RuntimeState.Connected) {
                this.setState(types_1.RuntimeState.Connected);
            }
            return this.current;
        }
        // Prevent concurrent Connect commands from opening multiple kernel
        // discovery flows. This also avoids a race where the second flow sees
        // no active notebook kernel while the first flow is still connecting.
        if (this.connecting) {
            return this.connecting;
        }
        this.connecting = this.establishAndConnect(config);
        try {
            return await this.connecting;
        }
        finally {
            this.connecting = null;
        }
    }
    async establishAndConnect(config) {
        this.setState(types_1.RuntimeState.Connecting);
        try {
            const info = await this.establish(config);
            if (!info) {
                this.setState(types_1.RuntimeState.Disconnected);
                return undefined;
            }
            await this.verifyRemoteRoot(info.remoteFs);
            this.current = info;
            await this.persist(info, config);
            this.setState(types_1.RuntimeState.Connected);
            this.logger.info(`Connected: ${info.runtimeLabel}`);
            return info;
        }
        catch (error) {
            this.setState(types_1.RuntimeState.Error, error.message);
            throw error;
        }
    }
    /**
     * Reconnect after a runtime loss or error. For Colab: verify the runtime
     * still exists; reassign when it was recycled. Then re-verify the project
     * directory so the engine can rebuild it from local.
     */
    async reconnect(config) {
        this.logger.info('Reconnecting runtime...');
        this.setState(types_1.RuntimeState.Connecting);
        const persisted = this.context.workspaceState.get(STATE_KEY);
        try {
            let info;
            if (persisted?.kind === 'colab' && persisted.runtimeName) {
                info = await this.reattachOrReassign(persisted.runtimeName, config);
            }
            info ??= await this.establish(config);
            if (!info) {
                this.setState(types_1.RuntimeState.Disconnected);
                return undefined;
            }
            await this.verifyRemoteRoot(info.remoteFs);
            this.current = info;
            await this.persist(info, config);
            this.setState(types_1.RuntimeState.Connected);
            this.logger.info(`Reconnected: ${info.runtimeLabel}`);
            return info;
        }
        catch (error) {
            this.setState(types_1.RuntimeState.Error, error.message);
            throw error;
        }
    }
    /** Disconnect. Local files are never touched. */
    async disconnect() {
        this.current = null;
        await this.context.workspaceState.update(STATE_KEY, undefined);
        this.setState(types_1.RuntimeState.Disconnected);
        this.logger.info('Disconnected');
    }
    // ------------------------------------------------------------ internals
    async establish(config) {
        const colabAvailable = (0, authentication_1.isColabExtensionAvailable)();
        const choices = [];
        if (colabAvailable) {
            choices.push({
                id: 'colab',
                label: '$(cloud) Google Colab',
                description: 'Sign in with Google and assign a Colab runtime',
            });
        }
        else {
            choices.push({
                id: 'colab',
                label: '$(cloud) Google Colab',
                description: 'Requires the official Colab extension (not installed)',
            });
        }
        choices.push({
            id: 'manual',
            label: '$(server) Manual Jupyter server',
            description: 'Any Jupyter server URL + token',
        });
        const pick = await vscode.window.showQuickPick(choices, {
            title: 'Colab Sync: Connect',
            placeHolder: 'Choose how to connect to a runtime',
            ignoreFocusOut: true,
        });
        if (!pick) {
            return undefined;
        }
        if (pick.id === 'colab') {
            return this.connectColab(config);
        }
        return this.connectManual(config);
    }
    async connectColab(config) {
        // A selected Colab kernel can be visible in the notebook UI before the
        // Jupyter API exposes an active kernel object. Bootstrap that selected
        // kernel by executing a temporary, immediately removed cell. The code
        // is intentionally valid in both supported languages.
        await bootstrapNotebookKernel(this.logger);
        const binding = await getActiveNotebookKernel(this.logger);
        if (!binding) {
            throw new Error(
                'No active Colab notebook kernel is available. Open the project .ipynb, select the Colab kernel (Python or R), make sure Colab Sync is allowed in Jupyter: Manage Access to Jupyter Kernels, and try Connect again.',
            );
        }
        this.logger.info(
            `Binding to the exact notebook kernel: ${binding.notebookLabel} (${binding.kernelId ?? 'kernel'})`,
        );
        const remoteFs = new colabKernelFileSystem_1.ColabKernelFileSystem({
            notebookUri: binding.notebookUri,
            remoteRoot: config.remoteRoot,
            getKernel: binding.getKernel,
            language: binding.language,
            logger: this.logger,
        });
        return {
            kind: 'colab',
            remoteFs,
            runtimeLabel: `Colab notebook kernel — ${binding.notebookLabel}`,
            runtimeName: binding.kernelId,
        };
    }

    async reattachOrReassign(runtimeName, config) {
        // Reconnect is always notebook-bound for Colab. Never assign or select
        // another runtime behind the user's active notebook.
        this.logger.info('Reconnecting from the active Colab notebook kernel');
        return this.connectColab(config);
    }

    colabConnection(_runtime, _config) {
        throw new Error('Legacy Colab runtime connection is disabled; use the active notebook kernel');
    }
    async connectManual(config) {
        const manual = await (0, authentication_1.promptManualConnection)(this.context.secrets);
        if (!manual) {
            return undefined;
        }
        const remoteFs = new jupyterContentsFileSystem_1.JupyterContentsFileSystem({ baseUrl: manual.baseUrl, token: manual.token }, config.remoteRoot);
        const alive = await remoteFs.ping();
        if (!alive) {
            throw new Error(`Cannot reach Jupyter server at ${manual.baseUrl}. Check the URL and token.`);
        }
        return {
            kind: 'manual',
            remoteFs,
            runtimeLabel: `Jupyter ${new URL(manual.baseUrl).host}`,
        };
    }
    /** Ensure the remote project directory exists (create when missing). */
    async verifyRemoteRoot(remoteFs) {
        const ensure = remoteFs.ensureProjectRoot;
        if (typeof ensure === 'function') {
            await ensure.call(remoteFs);
            this.logger.info('Remote project directory ready');
            return;
        }
        const exists = await remoteFs.rootExists();
        if (!exists) {
            this.logger.info('Remote project directory does not exist yet; it will be created on first upload');
        }
    }
    async persist(info, config) {
        const persisted = {
            kind: info.kind,
            remoteRoot: config.remoteRoot,
        };
        if (info.runtimeName !== undefined) {
            persisted.runtimeName = info.runtimeName;
        }
        await this.context.workspaceState.update(STATE_KEY, persisted);
    }
}
exports.ConnectionManager = ConnectionManager;
//# sourceMappingURL=connection.js.map
async function bootstrapNotebookKernel(logger) {
    const notebook = getPreferredNotebookForConnection();
    if (!notebook) {
        throw new Error('Open a project .ipynb notebook and select a Colab kernel before connecting.');
    }

    const language = inferNotebookLanguage(notebook);
    if (language !== 'python' && language !== 'r') {
        throw new Error('Colab Sync supports Colab Python and R kernels only. Select a Python or R Colab kernel before connecting.');
    }

    const code = 'print("Connection request")';
    const cellData = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, language);
    cellData.metadata = {
        colabsync: { temporaryConnectionCell: true },
    };
    const insertIndex = notebook.cellCount;
    const edit = new vscode.WorkspaceEdit();
    edit.set(notebook.uri, [vscode.NotebookEdit.insertCells(insertIndex, [cellData])]);

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
        throw new Error('Colab Sync could not create its temporary kernel connection cell.');
    }

    try {
        // VS Code exposes the built-in notebook.cell.execute command. Executing
        // the temporary cell asks the selected notebook controller to start the
        // kernel, without running any user-authored notebook code.
        await vscode.commands.executeCommand('notebook.cell.execute', {
            ranges: [{ start: insertIndex, end: insertIndex + 1 }],
        });

        // Give Jupyter/Colab a short window to register the kernel with its API.
        for (let attempt = 0; attempt < 15; attempt++) {
            const current = vscode.workspace.notebookDocuments.find((doc) => doc.uri.toString() === notebook.uri.toString());
            const temp = current?.cells?.find?.((cell) => cell?.metadata?.colabsync?.temporaryConnectionCell);
            if (temp?.executionSummary?.success === true || temp?.executionSummary?.success === false || typeof temp?.executionSummary?.executionOrder === 'number') {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        logger.info(`Requested Colab ${language.toUpperCase()} kernel startup with temporary connection cell`);
    }
    finally {
        // Remove the temporary cell so the user's notebook is left unchanged.
        const current = vscode.workspace.notebookDocuments.find((doc) => doc.uri.toString() === notebook.uri.toString());
        if (current) {
            let tempIndex = -1;
            for (let i = 0; i < current.cellCount; i++) {
                if (current.cellAt(i)?.metadata?.colabsync?.temporaryConnectionCell) {
                    tempIndex = i;
                    break;
                }
            }
            if (tempIndex >= 0) {
                const remove = new vscode.WorkspaceEdit();
                remove.set(current.uri, [vscode.NotebookEdit.deleteCells(new vscode.NotebookRange(tempIndex, tempIndex + 1))]);
                await vscode.workspace.applyEdit(remove);
            }
        }
    }
}

function getPreferredNotebookForConnection() {
    const active = vscode.window.activeNotebookEditor?.notebook;
    if (active?.uri?.scheme === 'file') return active;

    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const notebooks = vscode.workspace.notebookDocuments.filter((doc) => doc.uri.scheme === 'file');
    return notebooks.find((doc) => workspaceFolders.length === 0 || workspaceFolders.some((folder) => {
        const root = require('node:path').resolve(folder.uri.fsPath) + require('node:path').sep;
        const target = require('node:path').resolve(doc.uri.fsPath);
        return target === require('node:path').resolve(folder.uri.fsPath) || target.startsWith(root);
    })) ?? notebooks[0];
}

function inferNotebookLanguage(notebook) {
    let rCells = 0;
    let pythonCells = 0;
    try {
        for (let i = 0; i < notebook.cellCount; i++) {
            const detected = normalizeKernelLanguage(notebook.cellAt(i)?.document?.languageId);
            if (detected === 'r') rCells++;
            else if (detected === 'python') pythonCells++;
        }
    }
    catch {
        // Continue with notebook metadata.
    }
    if (rCells > pythonCells && rCells > 0) return 'r';
    if (pythonCells > 0) return 'python';

    const metadataValues = [
        notebook?.metadata?.language_info?.name,
        notebook?.metadata?.language_info?.language,
        notebook?.metadata?.kernelspec?.language,
        notebook?.metadata?.kernelspec?.name,
        notebook?.metadata?.kernelspec?.display_name,
    ];
    for (const value of metadataValues) {
        const detected = normalizeKernelLanguage(value);
        if (detected) return detected;
    }
    return '';
}

async function getActiveNotebookKernel(logger) {
    const jupyterExt = vscode.extensions.getExtension('ms-toolsai.jupyter');
    if (!jupyterExt) {
        logger.warn('Jupyter extension is not installed; cannot bind Colab Sync to a notebook kernel');
        return undefined;
    }
    await jupyterExt.activate();
    const api = jupyterExt.exports;
    if (!api?.kernels?.getKernel) {
        logger.warn('The installed Jupyter extension does not expose the stable kernel execution API');
        return undefined;
    }

    const docs = [];
    const active = vscode.window.activeNotebookEditor?.notebook;
    if (active) docs.push(active);
    for (const doc of vscode.workspace.notebookDocuments) {
        if (!docs.some((d) => d.uri.toString() === doc.uri.toString())) docs.push(doc);
    }

    // Prefer an open notebook that is inside the current workspace. The active
    // notebook is first, so Connect follows what the user is executing.
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const inWorkspace = (uri) => workspaceFolders.length === 0 || workspaceFolders.some((folder) => {
        const root = require('node:path').resolve(folder.uri.fsPath) + require('node:path').sep;
        const target = require('node:path').resolve(uri.fsPath);
        return target === require('node:path').resolve(folder.uri.fsPath) || target.startsWith(root);
    });

    for (const doc of docs) {
        if (doc.uri.scheme !== 'file' || !inWorkspace(doc.uri)) continue;
        let kernel;
        // A selected Colab kernel may take a short time to become available
        // through the stable Jupyter extension API. Do not require the user
        // to execute a notebook cell just to make ColabSync discover it.
        for (let attempt = 0; attempt < 12 && !kernel; attempt++) {
            try {
                kernel = await api.kernels.getKernel(doc.uri);
            }
            catch (error) {
                logger.debug(`Kernel API access failed for ${doc.uri.fsPath}: ${error?.message ?? String(error)}`);
            }
            if (!kernel && attempt < 11) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
        if (!kernel) {
            logger.debug(`No active kernel became available for ${doc.uri.fsPath} during the discovery window`);
            continue;
        }

        const language = inferKernelLanguage(kernel, doc, vscode.window.activeNotebookEditor);
        const supported = language === 'python' || language === 'r';
        if (!supported) {
            logger.debug(`Skipping unsupported notebook kernel for ${doc.uri.fsPath}: ${kernel.language ?? kernel.kernelLanguage ?? kernel.languageId ?? kernel.label ?? kernel.displayName ?? 'unknown'}`);
            continue;
        }

        const notebookUri = doc.uri;
        const notebookLabel = require('node:path').basename(notebookUri.fsPath);
        logger.info(`Active notebook kernel found: ${notebookLabel}${kernel.id ? ` [${kernel.id}]` : ''}`);
        logger.info(`Detected notebook kernel language: ${language.toUpperCase()}`);

        // Resolve the kernel again for every operation. This survives kernel
        // restarts/reconnects while remaining tied to the same notebook URI.
        const getKernel = async () => {
            const ext = vscode.extensions.getExtension('ms-toolsai.jupyter');
            if (!ext) throw new Error('Jupyter extension is no longer available');
            await ext.activate();
            const currentApi = ext.exports;
            const current = await currentApi?.kernels?.getKernel(notebookUri);
            if (!current) {
                throw new Error(`No active kernel for notebook ${notebookLabel}`);
            }
            const currentLanguage = inferKernelLanguage(current, doc, vscode.window.activeNotebookEditor);
            if (currentLanguage !== language) {
                throw new Error(`Notebook ${notebookLabel} is no longer using the ${language === 'r' ? 'R' : 'Python'} kernel (detected ${currentLanguage || 'unknown'})`);
            }
            return current;
        };

        return {
            notebookUri,
            notebookLabel,
            kernelId: typeof kernel.id === 'string' ? kernel.id : undefined,
            language,
            getKernel,
        };
    }

    return undefined;
}

/**
 * Jupyter kernel objects do not always expose a populated `language` field,
 * especially for Colab/IRkernel sessions. Prefer explicit kernel metadata,
 * then inspect the notebook cells' languageId, then common display labels.
 */
function inferKernelLanguage(kernel, notebook, activeEditor) {
    // The Jupyter extension's kernel.language can be misleading for Colab
    // sessions (some R/IRkernel sessions report a Python-compatible value).
    // Notebook cell languageId + kernelspec metadata are stronger signals for
    // the language the user is actually editing/executing.
    const activeSameNotebook = activeEditor?.notebook?.uri?.toString?.() === notebook?.uri?.toString?.();
    if (activeSameNotebook) {
        try {
            const selection = activeEditor.selections?.[0];
            const index = Math.max(0, Math.min(selection?.start ?? 0, notebook.cellCount - 1));
            if (notebook.cellCount > 0) {
                const activeLanguage = normalizeKernelLanguage(notebook.cellAt(index)?.document?.languageId);
                if (activeLanguage) return activeLanguage;
            }
        }
        catch {
            // Ignore active-cell inspection failures and continue with notebook metadata.
        }
    }

    // Count explicit notebook cell language IDs. This avoids trusting a kernel
    // object's generic/default language field when the notebook itself clearly
    // contains R or Python code.
    let rCells = 0;
    let pythonCells = 0;
    try {
        for (let i = 0; i < notebook.cellCount; i++) {
            const detected = normalizeKernelLanguage(notebook.cellAt(i)?.document?.languageId);
            if (detected === 'r') rCells++;
            else if (detected === 'python') pythonCells++;
        }
    }
    catch {
        // Ignore metadata inspection failures.
    }
    if (rCells > 0 || pythonCells > 0) {
        if (rCells > pythonCells) return 'r';
        if (pythonCells > rCells) return 'python';
    }

    // Notebook metadata is more trustworthy than the generic kernel.language
    // property for Colab/IRkernel sessions.
    const metadataValues = [
        notebook?.metadata?.language_info?.name,
        notebook?.metadata?.language_info?.language,
        notebook?.metadata?.kernelspec?.language,
        notebook?.metadata?.kernelspec?.name,
        notebook?.metadata?.kernelspec?.display_name,
    ];
    for (const value of metadataValues) {
        const detected = normalizeKernelLanguage(value);
        if (detected) return detected;
    }

    // Finally inspect kernel metadata/labels.
    const kernelValues = [
        kernel?.language_info?.name,
        kernel?.language_info?.language,
        kernel?.kernelSpec?.language,
        kernel?.kernelspec?.language,
        kernel?.kernelSpec?.languageId,
        kernel?.kernelspec?.languageId,
        kernel?.label,
        kernel?.displayName,
        kernel?.name,
        kernel?.kernelLanguage,
        kernel?.language,
        kernel?.languageId,
    ];
    for (const value of kernelValues) {
        const detected = normalizeKernelLanguage(value);
        if (detected) return detected;
    }

    return '';
}

function normalizeKernelLanguage(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return '';
    // Python labels seen in Jupyter/Colab: python, python3, ipykernel, etc.
    if (text === 'python' || text === 'python3' || text.includes('ipykernel') || text.includes('python')) {
        return 'python';
    }
    // R labels seen in IRkernel/Colab: r, rscript, irkernel, ir, R Kernel.
    if (text === 'r' || text === 'ir' || text === 'rscript' || text.includes('irkernel') || text.includes('r kernel') || text.includes('rscript') || /^r[0-9.]+$/.test(text)) {
        return 'r';
    }
    return '';
}
