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
exports.OutputChannelLogger = void 0;
exports.redact = redact;
/**
 * ColabSync output-channel logger with secret redaction.
 *
 * Wraps a VS Code LogOutputChannel. Tokens, authorization headers, and
 * anything shaped like a credential are redacted before they can reach the
 * log. Credentials must never appear in the output channel.
 */
const vscode = __importStar(require("vscode"));
const LEVEL_ORDER = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};
/** Patterns that must never reach the log. */
const SECRET_PATTERNS = [
    /token=[^&\s]+/gi,
    /Authorization:\s*(token|Bearer)\s+\S+/gi,
    /"token"\s*:\s*"[^"]+"/gi,
    /ya29\.[A-Za-z0-9._-]+/g, // Google OAuth access tokens
    /[?&]token=[^&\s]+/gi,
];
function redact(input) {
    let out = input;
    for (const pattern of SECRET_PATTERNS) {
        out = out.replace(pattern, (m) => m.includes('=') ? m.replace(/=.*/, '=<redacted>') : '<redacted>');
    }
    return out;
}
class OutputChannelLogger {
    channel;
    level;
    constructor(level = 'info') {
        this.channel = vscode.window.createOutputChannel('Colab Sync', {
            log: true,
        });
        this.level = level;
    }
    setLevel(level) {
        this.level = level;
    }
    getLevel() {
        return this.level;
    }
    show() {
        this.channel.show(true);
    }
    dispose() {
        this.channel.dispose();
    }
    error(message, ...args) {
        if (LEVEL_ORDER[this.level] >= LEVEL_ORDER.error) {
            this.channel.error(redact(format(message, args)));
        }
    }
    warn(message, ...args) {
        if (LEVEL_ORDER[this.level] >= LEVEL_ORDER.warn) {
            this.channel.warn(redact(format(message, args)));
        }
    }
    info(message, ...args) {
        if (LEVEL_ORDER[this.level] >= LEVEL_ORDER.info) {
            this.channel.info(redact(format(message, args)));
        }
    }
    debug(message, ...args) {
        if (LEVEL_ORDER[this.level] >= LEVEL_ORDER.debug) {
            this.channel.debug(redact(format(message, args)));
        }
    }
}
exports.OutputChannelLogger = OutputChannelLogger;
function format(message, args) {
    if (args.length === 0) {
        return message;
    }
    const rest = args
        .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a)))
        .join(' ');
    return `${message} ${rest}`;
}
//# sourceMappingURL=logger.js.map