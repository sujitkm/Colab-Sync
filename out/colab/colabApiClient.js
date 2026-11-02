"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ColabApiClient = exports.ColabApiError = void 0;
const types_1 = require("../types");
const remoteFileSystem_1 = require("../remote/remoteFileSystem");
const API_BASE = 'https://colaboratory.googleapis.com';
const OPERATION_POLL_MS = 2000;
const OPERATION_TIMEOUT_MS = 180_000;
class ColabApiError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'ColabApiError';
    }
}
exports.ColabApiError = ColabApiError;
class ColabApiClient {
    getAccessToken;
    logger;
    constructor(getAccessToken, logger = types_1.NULL_LOGGER) {
        this.getAccessToken = getAccessToken;
        this.logger = logger;
    }
    /** Assign a new runtime and wait for it to become ready. */
    async assignRuntime(variant = 'DEFAULT') {
        const requestId = crypto.randomUUID();
        const body = variant === 'DEFAULT'
            ? {}
            : { runtimeSpec: { key: { keys: [{ key: 'accelerator', value: variant }] } } };
        const operation = await this.request('POST', `/v1beta/runtimes?requestId=${encodeURIComponent(requestId)}`, body);
        const completed = await this.waitForOperation(operation);
        const runtime = completed.response;
        if (!runtime) {
            throw new ColabApiError('Assignment completed without a runtime');
        }
        return toRuntimeInfo(runtime);
    }
    /** List runtimes currently assigned to the user. */
    async listRuntimes() {
        const res = await this.request('GET', '/v1beta/runtimes');
        return (res.runtimes ?? [])
            .map((r) => safeToRuntimeInfo(r))
            .filter((r) => r !== null);
    }
    /** Get one runtime by resource name. Returns null when gone. */
    async getRuntime(name) {
        try {
            const runtime = await this.request('GET', `/v1beta/${encodeURIComponent(name).replaceAll('%2F', '/')}`);
            return toRuntimeInfo(runtime);
        }
        catch (error) {
            if (error instanceof ColabApiError && error.status === 404) {
                return null;
            }
            throw error;
        }
    }
    /** Release (delete) a runtime. */
    async deleteRuntime(name) {
        await this.request('DELETE', `/v1beta/${encodeURIComponent(name).replaceAll('%2F', '/')}`);
    }
    // ------------------------------------------------------------ internals
    async waitForOperation(op) {
        const deadline = Date.now() + OPERATION_TIMEOUT_MS;
        let current = op;
        while (!current.done) {
            if (current.error) {
                throw new ColabApiError(`Runtime assignment failed: ${current.error.message ?? 'unknown error'}`, current.error.code);
            }
            if (Date.now() > deadline) {
                throw new ColabApiError('Timed out waiting for runtime assignment');
            }
            if (!current.name) {
                throw new ColabApiError('Operation has no name to poll');
            }
            await sleep(OPERATION_POLL_MS);
            const opName = current.name.replace(/^operations\//, '');
            current = await this.request('GET', `/v1/operations/${encodeURIComponent(opName)}`);
            this.logger.debug(`Polling operation ${opName}`);
        }
        if (current.error) {
            throw new ColabApiError(`Runtime assignment failed: ${current.error.message ?? 'unknown error'}`, current.error.code);
        }
        return current;
    }
    async request(method, path, body) {
        const token = await this.getAccessToken();
        const url = `${API_BASE}${path}`;
        let res;
        try {
            res = await fetch(url, {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(body !== undefined
                        ? { 'Content-Type': 'application/json' }
                        : {}),
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
        }
        catch (error) {
            throw new remoteFileSystem_1.RemoteTransientError(`Colab API network error: ${error.message}`);
        }
        if (res.status === 401 || res.status === 403) {
            throw new remoteFileSystem_1.RemoteAuthError(`Colab API rejected authentication (HTTP ${res.status})`);
        }
        if (res.status === 429 || res.status >= 500) {
            throw new remoteFileSystem_1.RemoteTransientError(`Colab API HTTP ${res.status}`);
        }
        if (!res.ok) {
            const detail = (await res.text().catch(() => '')).slice(0, 300);
            throw new ColabApiError(`Colab API ${method} ${path} failed: HTTP ${res.status} ${detail}`, res.status);
        }
        const text = await res.text();
        return (text === '' ? {} : JSON.parse(text));
    }
}
exports.ColabApiClient = ColabApiClient;
function toRuntimeInfo(runtime) {
    const info = safeToRuntimeInfo(runtime);
    if (!info) {
        throw new ColabApiError('Runtime is missing connection information (url/token)');
    }
    return info;
}
function safeToRuntimeInfo(runtime) {
    const ci = runtime.connectionInfo;
    if (!runtime.name || !ci?.url || !ci.token) {
        return null;
    }
    const info = {
        name: runtime.name,
        url: ci.url,
        token: ci.token,
    };
    if (ci.expireTime !== undefined) {
        info.expireTime = ci.expireTime;
    }
    if (runtime.version !== undefined) {
        info.version = runtime.version;
    }
    if (ci.headers !== undefined) {
        info.headers = { ...ci.headers };
    }
    return info;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=colabApiClient.js.map