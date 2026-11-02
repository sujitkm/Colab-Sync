"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JupyterContentsFileSystem = void 0;
const localFileSystem_1 = require("../filesystem/localFileSystem");
const pathSafety_1 = require("../filesystem/pathSafety");
const remoteFileSystem_1 = require("./remoteFileSystem");
const LIST_CONCURRENCY = 4;
class JupyterContentsFileSystem {
    id;
    baseUrl;
    remoteRoot;
    apiRoot;
    headers;
    timeoutMs;
    constructor(connection, remoteRoot, apiRoot) {
        this.remoteRoot = (0, pathSafety_1.normalizeRemoteRoot)(remoteRoot);
        // Colab's Jupyter server exposes /content as its Contents API root.
        // The logical project path may therefore be /content/Foo while the
        // Contents API path is simply Foo. Manual Jupyter servers keep the
        // old behavior unless apiRoot is explicitly supplied.
        this.apiRoot = (0, pathSafety_1.normalizeRemoteRoot)(apiRoot ?? remoteRoot);
        this.baseUrl = connection.baseUrl.replace(/\/+$/, '');
        this.id = `jupyter:${this.baseUrl}`;
        this.timeoutMs = connection.timeoutMs ?? 60_000;
        this.headers = { ...(connection.headers ?? {}) };
        if (connection.token) {
            this.headers['Authorization'] = `token ${connection.token}`;
        }
    }
    // ------------------------------------------------------------ public API
    async list() {
        const out = [];
        const walk = async (relDir) => {
            const model = await this.getModel(relDir, true);
            if (!model || model.type !== 'directory' || !Array.isArray(model.content)) {
                return;
            }
            const entries = model.content;
            const dirs = [];
            for (const entry of entries) {
                const rel = this.toRelative(entry.path);
                if (entry.type === 'directory') {
                    dirs.push(rel);
                }
                else {
                    out.push({
                        path: rel,
                        size: entry.size ?? 0,
                        mtime: toMtime(entry.last_modified),
                        isDirectory: false,
                    });
                }
            }
            // Bounded-parallel directory walk.
            for (let i = 0; i < dirs.length; i += LIST_CONCURRENCY) {
                await Promise.all(dirs.slice(i, i + LIST_CONCURRENCY).map(walk));
            }
        };
        await walk('');
        return out;
    }
    async stat(relPath) {
        const model = await this.getModel(relPath, false);
        if (!model) {
            return null;
        }
        return {
            path: this.toRelative(model.path),
            size: model.size ?? 0,
            mtime: toMtime(model.last_modified),
            isDirectory: model.type === 'directory',
        };
    }
    async read(relPath) {
        const model = await this.getModel(relPath, true);
        if (!model) {
            throw new remoteFileSystem_1.RemoteNotFoundError(`No such remote file: ${relPath}`, relPath);
        }
        if (model.type === 'directory') {
            throw new Error(`Cannot read directory: ${relPath}`);
        }
        if (model.format === 'base64' && typeof model.content === 'string') {
            return Buffer.from(model.content, 'base64');
        }
        if (model.format === 'json') {
            return Buffer.from(JSON.stringify(model.content), 'utf-8');
        }
        if (typeof model.content === 'string') {
            return Buffer.from(model.content, 'utf-8');
        }
        if (model.content === null || model.content === undefined) {
            return Buffer.alloc(0);
        }
        throw new Error(`Unsupported content format for ${relPath}: ${String(model.format)}`);
    }
    async write(relPath, content) {
        // Colab's Contents proxy does not reliably support the Jupyter
        // temp-upload + PATCH/rename sequence. In particular, PATCH can return
        // HTTP 409 when the destination already exists, and after a runtime
        // recycle the temp endpoint may return 404. Use the documented Jupyter
        // PUT-to-final-path operation instead; PUT is also the normal update
        // operation for an existing file.
        try {
            return await this.writeOnce(relPath, content);
        }
        catch (err) {
            if (!(err instanceof remoteFileSystem_1.RemoteNotFoundError)) {
                throw err;
            }
            // Runtime/project root may have disappeared. Recreate the complete
            // root chain and retry the final PUT once.
            this.rootEnsured = false;
            await this.ensureRoot();
            return await this.writeOnce(relPath, content);
        }
    }
    async writeOnce(relPath, content) {
        await this.ensureRoot();
        // Ensure parent directories exist (Jupyter does not create them).
        const parent = relPath.split('/').slice(0, -1).join('/');
        if (parent !== '') {
            await this.mkdir(parent);
        }
        const isText = isUtf8Text(content);
        const name = relPath.split('/').pop() ?? relPath;
        const remotePath = (0, pathSafety_1.joinRemotePath)(this.apiRoot, relPath);
        // Use the final path directly. This is compatible with Colab's runtime
        // Contents proxy and avoids PATCH/rename conflicts on existing files.
        const body = isText
            ? {
                name,
                path: remotePath,
                type: 'file',
                format: 'text',
                content: content.toString('utf-8'),
            }
            : {
                name,
                path: remotePath,
                type: 'file',
                format: 'base64',
                content: content.toString('base64'),
            };
        const model = await this.request('PUT', relPath, body);
        return {
            mtime: toMtime(model?.last_modified),
            size: model?.size ?? content.length,
        };
    }
    async delete(relPath) {
        await this.request('DELETE', relPath);
    }
    async mkdir(relPath) {
        await this.ensureRoot();
        // Create each missing segment; existing segments return 400 on PUT,
        // so stat first and only create what is missing.
        const segments = relPath.split('/');
        let current = '';
        for (const segment of segments) {
            current = current === '' ? segment : `${current}/${segment}`;
            const existing = await this.getModel(current, false);
            if (existing) {
                continue;
            }
            await this.request('PUT', current, { type: 'directory' });
        }
    }
    /**
     * Create the remote root directory chain if missing. Jupyter returns 404
     * when PUT-ing into a non-existent parent, so the root itself must be
     * created segment by segment before any project write.
     */
    rootEnsured = false;
    async ensureRoot() {
        if (this.rootEnsured) {
            return;
        }
        const segments = this.apiRoot
            .replace(/^\/+/, '')
            .split('/')
            .filter((s) => s !== '');
        let current = '';
        for (const segment of segments) {
            current = current === '' ? segment : `${current}/${segment}`;
            const url = `${this.baseUrl}/api/contents/${encodePath(current)}`;
            const res = await this.rawRequest('GET', `${url}?content=0`);
            if (res.status === 404) {
                const put = await this.rawRequest('PUT', url, { type: 'directory' });
                await this.assertOk(put, 'PUT', current);
            }
            else {
                await this.assertOk(res, 'GET', current);
            }
        }
        this.rootEnsured = true;
    }
    async ping() {
        try {
            const res = await this.rawRequest('GET', this.apiUrl(''));
            return res.status === 200 || res.status === 404;
        }
        catch {
            return false;
        }
    }
    async ensureProjectRoot() {
        await this.ensureRoot();
    }
    async rootExists() {
        try {
            const model = await this.getModel('', false);
            const exists = model !== null && model.type === 'directory';
            if (!exists) {
                this.rootEnsured = false;
            }
            return exists;
        }
        catch {
            this.rootEnsured = false;
            return false;
        }
    }
    // ------------------------------------------------------------ internals
    /** Root-relative POSIX path from a server-absolute content path. */
    toRelative(serverPath) {
        const root = this.apiRoot.replace(/^\//, '');
        let p = serverPath.replace(/^\//, '');
        // Colab may return Contents API model paths either relative to the
        // Jupyter contents root (Foo/bar) or with the underlying /content
        // prefix (content/Foo/bar). Accept both representations.
        const candidates = [p];
        if (p.startsWith('content/')) {
            candidates.push(p.slice('content/'.length));
        }
        for (const candidate of candidates) {
            if (candidate === root) {
                return '';
            }
            if (candidate.startsWith(root + '/')) {
                return candidate.slice(root.length + 1);
            }
        }
        // Server returned a path outside our root — refuse it.
        throw new Error(`Remote path outside project root: ${serverPath}`);
    }
    apiUrl(relPath) {
        const abs = relPath === '' ? this.apiRoot : (0, pathSafety_1.joinRemotePath)(this.apiRoot, relPath);
        // Strip the leading slash so the URL never contains a double slash.
        return `${this.baseUrl}/api/contents/${encodePath(abs.replace(/^\/+/, ''))}`;
    }
    async getModel(relPath, withContent) {
        const url = this.apiUrl(relPath) + (withContent ? '?content=1' : '?content=0');
        const res = await this.rawRequest('GET', url);
        if (res.status === 404) {
            return null;
        }
        await this.assertOk(res, 'GET', relPath);
        return (await res.json());
    }
    async request(method, relPath, body) {
        const res = await this.rawRequest(method, this.apiUrl(relPath), body);
        if (res.status === 404) {
            throw new remoteFileSystem_1.RemoteNotFoundError(`No such remote path: ${relPath}`, relPath);
        }
        await this.assertOk(res, method, relPath);
        if (res.status === 204 || method === 'DELETE') {
            return null;
        }
        const text = await res.text();
        return text === '' ? null : JSON.parse(text);
    }
    async rawRequest(method, url, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const headers = { ...this.headers };
            let payload;
            if (body !== undefined) {
                headers['Content-Type'] = 'application/json';
                payload = JSON.stringify(body);
            }
            return await fetch(url, {
                method,
                headers,
                body: payload,
                signal: controller.signal,
                redirect: 'follow',
            });
        }
        catch (error) {
            if (error.name === 'AbortError') {
                throw new remoteFileSystem_1.RemoteTransientError(`Request timed out: ${method} ${url}`);
            }
            throw new remoteFileSystem_1.RemoteTransientError(`Network error on ${method} ${url}: ${error.message}`);
        }
        finally {
            clearTimeout(timer);
        }
    }
    async assertOk(res, method, relPath) {
        if (res.ok) {
            return;
        }
        const detail = await res.text().catch(() => '');
        const safe = detail.slice(0, 300);
        if (res.status === 401 || res.status === 403) {
            throw new remoteFileSystem_1.RemoteAuthError(`${method} ${relPath}: authentication rejected (HTTP ${res.status})`);
        }
        if (res.status === 404) {
            throw new remoteFileSystem_1.RemoteNotFoundError(`${method} ${relPath}: not found (HTTP 404)`, relPath);
        }
        if (res.status === 408 || res.status === 429 || res.status >= 500) {
            throw new remoteFileSystem_1.RemoteTransientError(`${method} ${relPath}: HTTP ${res.status} ${safe}`);
        }
        throw new Error(`${method} ${relPath}: HTTP ${res.status} ${safe}`);
    }
}
exports.JupyterContentsFileSystem = JupyterContentsFileSystem;
function toMtime(iso) {
    if (!iso) {
        return Date.now();
    }
    const t = Date.parse(iso);
    return Number.isNaN(t) ? Date.now() : t;
}
/** Encode each path segment but keep `/` separators. */
function encodePath(p) {
    return p.split('/').map(encodeURIComponent).join('/');
}
/** Heuristic: content is UTF-8 text when it round-trips without replacement chars. */
function isUtf8Text(content) {
    if (content.includes(0)) {
        return false;
    }
    const s = content.toString('utf-8');
    return !s.includes('\u0000');
}
//# sourceMappingURL=jupyterContentsFileSystem.js.map