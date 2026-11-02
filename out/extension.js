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
exports.activate = activate;
exports.deactivate = deactivate;
/**
 * ColabSync extension entry point.
 *
 * "Run on Colab. Work locally. Stay synchronized."
 */
const vscode = __importStar(require("vscode"));
const controller_1 = require("./controller");
const logger_1 = require("./logging/logger");
const commands_1 = require("./commands");
const conflictResolver_1 = require("./sync/conflictResolver");
let controller;
async function activate(context) {
    const configuredLevel = vscode.workspace
        .getConfiguration('colabsync')
        .get('logLevel', 'info');
    const logger = new logger_1.OutputChannelLogger(configuredLevel);
    context.subscriptions.push({ dispose: () => logger.dispose() });
    logger.info('ColabSync activating');
    controller = new controller_1.ColabSyncController(context, logger);
    context.subscriptions.push(controller);
    (0, commands_1.registerCommands)(context, controller, logger);
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('colabsync-remote', new conflictResolver_1.RemoteContentProvider()));
    // React to log-level changes without requiring a reload.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('colabsync.logLevel')) {
            logger.setLevel(vscode.workspace
                .getConfiguration('colabsync')
                .get('logLevel', 'info'));
        }
    }));
    await controller.initialize();
    logger.info('ColabSync activated');
}
function deactivate() {
    controller?.dispose();
    controller = undefined;
}
//# sourceMappingURL=extension.js.map