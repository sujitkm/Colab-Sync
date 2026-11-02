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
exports.notifySyncComplete = notifySyncComplete;
exports.notifyConflicts = notifyConflicts;
exports.notifyRuntimeRebuilt = notifyRuntimeRebuilt;
/**
 * Centralized user notifications for ColabSync events.
 */
const vscode = __importStar(require("vscode"));
const types_1 = require("../types");
/** Notify about a completed sync run (quiet when nothing happened). */
async function notifySyncComplete(summary) {
    const uploaded = summary.results.filter((r) => r.state === types_1.TransferState.Completed &&
        r.direction === types_1.TransferDirection.Upload).length;
    const downloaded = summary.results.filter((r) => r.state === types_1.TransferState.Completed &&
        r.direction === types_1.TransferDirection.Download).length;
    const failed = summary.results.filter((r) => r.state === types_1.TransferState.Failed).length;
    const conflicts = (summary.plan.conflicts ?? []).filter((conflict) => !String(conflict?.path ?? '').toLowerCase().endsWith('.ipynb')).length;
    if (conflicts > 0) {
        const choice = await vscode.window.showWarningMessage(`Colab Sync: ${conflicts} conflict(s) need resolution.`, 'Resolve Conflicts');
        if (choice === 'Resolve Conflicts') {
            void vscode.commands.executeCommand('colabsync.resolveConflicts');
        }
        return;
    }
    if (failed > 0) {
        const choice = await vscode.window.showErrorMessage(`Colab Sync: ${failed} transfer(s) failed. See the Colab Sync output for details.`, 'Show Output');
        if (choice === 'Show Output') {
            void vscode.commands.executeCommand('colabsync.showStatus');
        }
        return;
    }
    if (uploaded + downloaded > 0) {
        void vscode.window.showInformationMessage(`Colab Sync: synced - ↑${uploaded} uploaded, ↓${downloaded} downloaded.`);
    }
}
/** Notify about conflicts detected outside a manual sync (watcher/poll). */
async function notifyConflicts(conflicts) {
    const realConflicts = (conflicts ?? []).filter((conflict) => !String(conflict?.path ?? '').toLowerCase().endsWith('.ipynb'));
    if (realConflicts.length === 0) {
        return;
    }
    const choice = await vscode.window.showWarningMessage(`Colab Sync: ${realConflicts.length} file(s) changed on both sides. No files were overwritten.`, 'Resolve Conflicts');
    if (choice === 'Resolve Conflicts') {
        void vscode.commands.executeCommand('colabsync.resolveConflicts');
    }
}
/** Notify that the remote runtime was recycled and is being rebuilt. */
async function notifyRuntimeRebuilt() {
    void vscode.window.showInformationMessage('Colab Sync: the Colab runtime was recycled. Rebuilding the remote project from your local files. Nothing local was deleted.');
}
//# sourceMappingURL=notifications.js.map