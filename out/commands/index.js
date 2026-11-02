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
exports.registerCommands = registerCommands;
/**
 * Command registrations. Each command is a thin delegate to the controller.
 */
const vscode = __importStar(require("vscode"));
const COMMANDS = [
    { id: 'colabsync.connect', run: (c) => c.connect() },
    { id: 'colabsync.disconnect', run: (c) => c.disconnect() },
    { id: 'colabsync.syncNow', run: (c) => c.syncNow() },
    { id: 'colabsync.push', run: (c) => c.push() },
    { id: 'colabsync.pull', run: (c) => c.pull() },
    { id: 'colabsync.initializeProject', run: (c) => c.initializeProject() },
    { id: 'colabsync.showStatus', run: (c) => c.showStatus() },
    { id: 'colabsync.resolveConflicts', run: (c) => c.resolveConflicts() },
    { id: 'colabsync.openSettings', run: (c) => c.openSettings() },
    { id: 'colabsync.reconnect', run: (c) => c.reconnect() },
];
function registerCommands(context, controller, logger) {
    for (const spec of COMMANDS) {
        context.subscriptions.push(vscode.commands.registerCommand(spec.id, async () => {
            try {
                await spec.run(controller);
            }
            catch (error) {
                logger.error(`Command ${spec.id} failed`, error);
                void vscode.window.showErrorMessage(`Colab Sync: ${error.message}`);
            }
        }));
    }
}
//# sourceMappingURL=index.js.map