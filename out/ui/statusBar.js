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
exports.StatusBar = void 0;
/**
 * ColabSync status bar item.
 *
 * States:
 *   $(cloud) Colab: Connecting...
 *   $(cloud) Colab: Connected
 *   $(sync~spin) Colab: Syncing...
 *   $(check) Colab: Synced
 *   $(warning) Colab: Conflict
 *   $(x) Colab: Disconnected
 *
 * Clicking opens a quick-pick menu of relevant actions.
 */
const vscode = __importStar(require("vscode"));
const types_1 = require("../types");
class StatusBar {
    item;
    state = types_1.RuntimeState.Disconnected;
    conflictCount = 0;
    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'colabsync.showStatus';
        this.render();
        this.item.show();
    }
    setState(state, conflictCount = 0) {
        this.state = state;
        this.conflictCount = conflictCount;
        this.render();
    }
    render() {
        switch (this.state) {
            case types_1.RuntimeState.Connecting:
                this.item.text = '$(cloud) Colab: Connecting...';
                this.item.tooltip = 'Colab Sync is connecting to a runtime';
                this.item.backgroundColor = undefined;
                break;
            case types_1.RuntimeState.Connected:
                this.item.text = '$(cloud) Colab: Connected';
                this.item.tooltip = 'Colab Sync is connected (click for actions)';
                this.item.backgroundColor = undefined;
                break;
            case types_1.RuntimeState.Syncing:
                this.item.text = '$(sync~spin) Colab: Syncing...';
                this.item.tooltip = 'Colab Sync is transferring files';
                this.item.backgroundColor = undefined;
                break;
            case types_1.RuntimeState.Conflict:
                this.item.text = `$(warning) Colab: Conflict (${this.conflictCount})`;
                this.item.tooltip = 'Colab Sync detected conflicts - click to resolve';
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case types_1.RuntimeState.Error:
                this.item.text = '$(warning) Colab: Error';
                this.item.tooltip = 'Colab Sync encountered an error - click for details';
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            case types_1.RuntimeState.Disconnected:
            default:
                this.item.text = '$(x) Colab: Disconnected';
                this.item.tooltip = 'Colab Sync is disconnected - click to connect';
                this.item.backgroundColor = undefined;
                break;
        }
    }
    dispose() {
        this.item.dispose();
    }
}
exports.StatusBar = StatusBar;
//# sourceMappingURL=statusBar.js.map