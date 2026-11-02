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
exports.ColabSyncTreeProvider = void 0;
/**
 * ColabSync activity-bar tree view.
 *
 *   Runtime
 *     Connected / Disconnected / runtime label
 *   Project
 *     ✓ Synced / ↑ Pending uploads / ↓ Pending downloads / ⚠ Conflicts
 *   Actions
 *     Sync Now / Push / Pull / Resolve Conflicts
 */
const vscode = __importStar(require("vscode"));
const types_1 = require("../types");
class Node extends vscode.TreeItem {
    kind;
    constructor(label, kind, collapsible = vscode
        .TreeItemCollapsibleState.None) {
        super(label, collapsible);
        this.kind = kind;
        this.contextValue = kind;
    }
}
class ColabSyncTreeProvider {
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    model = {
        state: types_1.RuntimeState.Disconnected,
        runtimeLabel: 'Not connected',
        remoteRoot: '',
        pendingUploads: 0,
        pendingDownloads: 0,
        conflicts: [],
        syncedFiles: 0,
    };
    update(model) {
        this.model = { ...this.model, ...model };
        this.emitter.fire(undefined);
    }
    dispose() {
        this.emitter.dispose();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            return [
                new Node('Runtime', 'runtime', vscode.TreeItemCollapsibleState.Expanded),
                new Node('Project', 'project', vscode.TreeItemCollapsibleState.Expanded),
                new Node('Actions', 'actions', vscode.TreeItemCollapsibleState.Expanded),
            ];
        }
        switch (element.kind) {
            case 'runtime':
                return this.runtimeChildren();
            case 'project':
                return this.projectChildren();
            case 'actions':
                return this.actionChildren();
            default:
                return [];
        }
    }
    runtimeChildren() {
        const m = this.model;
        const status = new Node(m.state === types_1.RuntimeState.Connected || m.state === types_1.RuntimeState.Syncing
            ? `$(cloud) ${m.runtimeLabel}`
            : m.state === types_1.RuntimeState.Connecting
                ? '$(loading~spin) Connecting...'
                : '$(circle-slash) Disconnected', 'info');
        const children = [status];
        if (m.remoteRoot !== '') {
            const root = new Node(`$(folder) ${m.remoteRoot}`, 'info');
            root.tooltip = 'Remote project directory';
            children.push(root);
        }
        return children;
    }
    projectChildren() {
        const m = this.model;
        const children = [];
        const synced = new Node(`$(check) ${m.syncedFiles} file(s) synced`, 'info');
        children.push(synced);
        if (m.pendingUploads > 0) {
            children.push(new Node(`$(arrow-up) ${m.pendingUploads} pending upload(s)`, 'info'));
        }
        if (m.pendingDownloads > 0) {
            children.push(new Node(`$(arrow-down) ${m.pendingDownloads} pending download(s)`, 'info'));
        }
        for (const conflict of m.conflicts) {
            const c = new Node(`$(warning) ${conflict.path}`, 'conflict');
            c.tooltip = 'Conflict - click to resolve';
            c.command = {
                command: 'colabsync.resolveConflicts',
                title: 'Resolve Conflicts',
            };
            children.push(c);
        }
        return children;
    }
    actionChildren() {
        const mk = (label, command, icon) => {
            const n = new Node(`$(${icon}) ${label}`, 'action');
            n.command = { command, title: label };
            return n;
        };
        return [
            mk('Sync Now', 'colabsync.syncNow', 'sync'),
            mk('Push Local Changes', 'colabsync.push', 'cloud-upload'),
            mk('Pull Remote Changes', 'colabsync.pull', 'cloud-download'),
            mk('Resolve Conflicts', 'colabsync.resolveConflicts', 'warning'),
        ];
    }
}
exports.ColabSyncTreeProvider = ColabSyncTreeProvider;
//# sourceMappingURL=treeView.js.map