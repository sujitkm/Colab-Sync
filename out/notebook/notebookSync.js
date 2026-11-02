"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotebookSyncTrigger = void 0;
/**
 * Notebook hook intentionally kept passive. Notebook execution belongs to
 * VS Code/Jupyter/Colab; ColabSync does not inject kernel operations during
 * Run or Run All. Remote changes are collected by the normal sync polling.
 */
class NotebookSyncTrigger {
    constructor(_logger, _requestSync) {}
    isExecuting() { return false; }
    dispose() {}
}
exports.NotebookSyncTrigger = NotebookSyncTrigger;
