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
exports.RemoteContentProvider = exports.ConflictResolver = void 0;
/**
 * Conflict resolution UI (VS Code layer).
 *
 * Text files: opens the VS Code diff editor (local <-> remote) so the user
 * can inspect before choosing.
 * Binary files: shows a metadata comparison (size, hash, mtime both sides).
 *
 * The user must explicitly choose Keep Local or Keep Remote; Cancel leaves
 * the conflict in place. Nothing is ever auto-overwritten.
 */
const vscode = __importStar(require("vscode"));
const TEXT_EXTENSIONS = new Set([
    '.txt', '.md', '.py', '.r', '.jl', '.js', '.ts', '.json', '.yaml', '.yml',
    '.csv', '.tsv', '.xml', '.html', '.css', '.sh', '.ipynb', '.toml', '.ini',
    '.cfg', '.rtf', '.sql', '.bib', '.tex',
]);
class ConflictResolver {
    workspaceRoot;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    /**
     * Interactively resolve one conflict. Returns the user's choice.
     * `remote` must be attached (used to fetch remote content for diffing).
     */
    async resolve(conflict, remote) {
        const isText = TEXT_EXTENSIONS.has(extensionOf(conflict.path));
        const buttons = ['Keep Local', 'Keep Remote'];
        if (isText) {
            buttons.push('Compare');
        }
        buttons.push('Cancel');
        const showPick = async () => vscode.window.showWarningMessage(`Conflict: ${conflict.path} changed both locally and remotely.`, { modal: true, detail: conflictDetail(conflict, isText) }, ...buttons);
        let choice = await showPick();
        while (choice === 'Compare') {
            await this.showDiff(conflict, remote);
            choice = await showPick();
        }
        switch (choice) {
            case 'Keep Local':
                return 'local';
            case 'Keep Remote':
                return 'remote';
            default:
                return 'cancel';
        }
    }
    /** Open the VS Code diff editor: local (left) vs remote (right). */
    async showDiff(conflict, remote) {
        const localUri = vscode.Uri.joinPath(this.workspaceRoot, conflict.path);
        const content = await remote.read(conflict.path);
        const remoteUri = vscode.Uri.parse(`colabsync-remote:/${conflict.path}`).with({ query: encodeURIComponent(content.toString('utf-8')) });
        await vscode.commands.executeCommand('vscode.diff', localUri, remoteUri, `${conflict.path} (Local ↔ Remote)`);
    }
}
exports.ConflictResolver = ConflictResolver;
function conflictDetail(conflict, isText) {
    const lines = [];
    if (conflict.localStat) {
        lines.push(`Local:  ${conflict.localStat.size} bytes, modified ${new Date(conflict.localStat.mtime).toLocaleString()}`);
    }
    if (conflict.remoteStat) {
        lines.push(`Remote: ${conflict.remoteStat.size} bytes, modified ${new Date(conflict.remoteStat.mtime).toLocaleString()}`);
    }
    if (!isText) {
        if (conflict.localHash) {
            lines.push(`Local hash:  ${conflict.localHash.slice(0, 16)}…`);
        }
        if (conflict.remoteHash) {
            lines.push(`Remote hash: ${conflict.remoteHash.slice(0, 16)}…`);
        }
        lines.push('(Binary file — content diff not available)');
    }
    return lines.join('\n');
}
function extensionOf(p) {
    const idx = p.lastIndexOf('.');
    return idx === -1 ? '' : p.slice(idx).toLowerCase();
}
/**
 * Readonly virtual document provider serving remote file content for the
 * diff editor (`colabsync-remote:` scheme).
 */
class RemoteContentProvider {
    provideTextDocumentContent(uri) {
        // Content is carried in the query string (already fetched by the
        // resolver); this keeps the provider synchronous and simple.
        try {
            return decodeURIComponent(uri.query);
        }
        catch {
            return '';
        }
    }
}
exports.RemoteContentProvider = RemoteContentProvider;
//# sourceMappingURL=conflictResolver.js.map