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
exports.AuthenticationError = exports.REQUIRED_SCOPES = exports.COLAB_EXTENSION_ID = exports.GOOGLE_PROVIDER_ID = void 0;
exports.isColabExtensionAvailable = isColabExtensionAvailable;
exports.getColabAccessToken = getColabAccessToken;
exports.promptManualConnection = promptManualConnection;
exports.clearManualToken = clearManualToken;
/**
 * Authentication for ColabSync.
 *
 * Two supported paths:
 *
 * 1. COMPANION (preferred): the official Google Colab extension
 *    (`google.colab`) contributes a VS Code authentication provider with id
 *    `google`. We request a session from it through the supported
 *    `vscode.authentication` API. Google OAuth tokens live in VS Code's
 *    authentication infrastructure — ColabSync never stores them.
 *
 * 2. MANUAL: the user supplies a Jupyter server base URL + token (works with
 *    any Jupyter server, including a Colab runtime proxy URL). The token is
 *    stored in VS Code SecretStorage — never in project files, never logged.
 */
const vscode = __importStar(require("vscode"));
exports.GOOGLE_PROVIDER_ID = 'google';
exports.COLAB_EXTENSION_ID = 'google.colab';
exports.REQUIRED_SCOPES = [
    'profile',
    'email',
    'https://www.googleapis.com/auth/colaboratory',
];
const MANUAL_TOKEN_SECRET_PREFIX = 'colabsync.manualToken:';
class AuthenticationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthenticationError';
    }
}
exports.AuthenticationError = AuthenticationError;
/** True when the official Colab extension is installed and active-able. */
function isColabExtensionAvailable() {
    return vscode.extensions.getExtension(exports.COLAB_EXTENSION_ID) !== undefined;
}
/**
 * Acquire a Google access token with the Colab scope via the official
 * extension's authentication provider. Throws AuthenticationError when the
 * provider is unavailable or the user declines.
 */
async function getColabAccessToken(logger) {
    if (!isColabExtensionAvailable()) {
        throw new AuthenticationError('The official Colab extension (google.colab) is not installed. ' +
            'Install it, or use "Connect manually" with a Jupyter server URL and token.');
    }
    logger.debug('Requesting Google session from the Colab auth provider');
    const session = await vscode.authentication.getSession(exports.GOOGLE_PROVIDER_ID, exports.REQUIRED_SCOPES, { createIfNone: true });
    if (!session) {
        throw new AuthenticationError('Google sign-in was cancelled');
    }
    logger.info(`Signed in as ${session.account.label}`);
    return session.accessToken;
}
/** Prompt for a manual Jupyter server connection. */
async function promptManualConnection(secrets) {
    const baseUrl = await vscode.window.showInputBox({
        title: 'Connect to Jupyter Server',
        prompt: 'Base URL of the Jupyter server (e.g. http://127.0.0.1:8888 or a Colab runtime proxy URL)',
        placeHolder: 'http://127.0.0.1:8888',
        ignoreFocusOut: true,
        validateInput: (value) => {
            try {
                const u = new URL(value);
                if (u.protocol !== 'http:' && u.protocol !== 'https:') {
                    return 'URL must use http or https';
                }
                return undefined;
            }
            catch {
                return 'Enter a valid URL';
            }
        },
    });
    if (!baseUrl) {
        return undefined;
    }
    const hostKey = new URL(baseUrl).host;
    const existing = await secrets.get(MANUAL_TOKEN_SECRET_PREFIX + hostKey);
    const token = await vscode.window.showInputBox({
        title: 'Connect to Jupyter Server',
        prompt: existing
            ? 'Auth token (leave empty to reuse the stored token)'
            : 'Auth token for the server (stored in VS Code SecretStorage)',
        password: true,
        ignoreFocusOut: true,
    });
    if (token === undefined) {
        return undefined;
    }
    const effective = token === '' && existing ? existing : token;
    if (effective === '') {
        void vscode.window.showWarningMessage('Colab Sync: no token provided; attempting an unauthenticated connection.');
    }
    else if (token !== '') {
        await secrets.store(MANUAL_TOKEN_SECRET_PREFIX + hostKey, effective);
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ''), token: effective };
}
/** Forget a stored manual token. */
async function clearManualToken(secrets, baseUrl) {
    try {
        await secrets.delete(MANUAL_TOKEN_SECRET_PREFIX + new URL(baseUrl).host);
    }
    catch {
        // best effort
    }
}
//# sourceMappingURL=authentication.js.map