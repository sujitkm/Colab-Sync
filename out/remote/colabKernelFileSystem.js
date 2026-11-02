"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ColabKernelFileSystem = void 0;
const path = require("node:path");
const vscode = require("vscode");
const remoteFileSystem_1 = require("./remoteFileSystem");
const pathSafety_1 = require("../filesystem/pathSafety");

const TEXT_MIMES = new Set(["text/plain", "text/x-python"]);
const ERROR_MIME = "application/vnd.code.notebook.error";
const READ_CHUNK = 256 * 1024;
const INLINE_WRITE_LIMIT = 6 * 1024 * 1024;
const WRITE_CHUNK = 4 * 1024 * 1024;
const PART_SUFFIX = ".colabsync-part";

/**
 * Remote filesystem backed by the exact Jupyter/Colab kernel attached to a
 * notebook. Supports both Python and R kernels by executing filesystem
 * operations in the kernel's native language.
 */
class ColabKernelFileSystem {
    id;
    remoteRoot;
    notebookUri;
    getKernel;
    logger;
    language;
    executionTail = Promise.resolve();
    constructor(options) {
        this.id = `colab-kernel:${options.notebookUri.toString()}`;
        this.remoteRoot = (0, pathSafety_1.normalizeRemoteRoot)(options.remoteRoot);
        this.notebookUri = options.notebookUri;
        this.getKernel = options.getKernel;
        this.language = String(options.language ?? "python").toLowerCase();
        this.logger = options.logger;
        if (this.language !== "r" && !this.language.includes("python")) {
            throw new Error(`Unsupported notebook kernel language: ${options.language}`);
        }
    }

    async list() {
        const code = this.language === "r" ? rCode(`
root <- ${rStr(this.remoteRoot)}
result <- list()
if (dir.exists(root)) {
  walk_files <- function(dirpath) {
    entries <- list.files(dirpath, full.names = TRUE, all.files = TRUE, no.. = TRUE)
    for (full in entries) {
      info <- file.info(full, extra_cols = FALSE)
      if (isTRUE(info$isdir)) {
        walk_files(full)
      } else if (file.exists(full)) {
        if (grepl(paste0(${rStr(PART_SUFFIX)}, "$"), basename(full), fixed = FALSE)) next
        rel <- substring(normalizePath(full, winslash = "/", mustWork = FALSE), nchar(normalizePath(root, winslash = "/", mustWork = FALSE)) + 2L)
        rel <- gsub("\\\\", "/", rel, fixed = TRUE)
        result[[length(result) + 1L]] <<- list(path = rel, size = as.numeric(info$size), mtime = as.numeric(info$mtime) * 1000, isDirectory = FALSE)
      }
    }
  }
  walk_files(root)
}
cat(jsonlite::toJSON(result, auto_unbox = TRUE, digits = NA, pretty = FALSE, dataframe = "rows", null = "null"), "\\n", sep = "")
`) : python(`
import json, os, stat
root = ${py(this.remoteRoot)}
result = []
if os.path.isdir(root):
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = [d for d in dirnames if not os.path.islink(os.path.join(dirpath, d))]
        for filename in filenames:
            if filename.endswith(${py(PART_SUFFIX)}):
                continue
            full = os.path.join(dirpath, filename)
            try:
                st = os.stat(full, follow_symlinks=False)
                if not stat.S_ISREG(st.st_mode):
                    continue
                rel = os.path.relpath(full, root).replace(os.sep, '/')
                result.append({"path": rel, "size": int(st.st_size), "mtime": int(st.st_mtime * 1000), "isDirectory": False})
            except (FileNotFoundError, PermissionError):
                continue
print(json.dumps(result, separators=(',', ':')))
`);
        const rows = parseJsonLine(await this.execText(code, "list"), []);
        return rows.map((row) => ({
            path: (0, pathSafety_1.normalizeRelativePath)(row.path),
            size: Number(row.size) || 0,
            mtime: Number(row.mtime) || 0,
            isDirectory: false,
        }));
    }

    async stat(relPath) {
        const p = this.absolute(relPath);
        const code = this.language === "r" ? rCode(`
p <- ${rStr(p)}
if (!file.exists(p) && !dir.exists(p)) {
  cat(${rStr('{"exists":false}')}, "\\n", sep = "")
} else {
  info <- file.info(p, extra_cols = FALSE)
  payload <- list(path = p, size = ifelse(is.na(info$size), 0, as.numeric(info$size)), mtime = as.numeric(info$mtime) * 1000, isDirectory = isTRUE(info$isdir), exists = TRUE)
  cat(jsonlite::toJSON(payload, auto_unbox = TRUE, digits = NA, pretty = FALSE, null = "null"), "\\n", sep = "")
}
`) : python(`
import json, os, stat
p = ${py(p)}
try:
    st = os.stat(p, follow_symlinks=False)
    print(json.dumps({"path": p, "size": int(st.st_size), "mtime": int(st.st_mtime * 1000), "isDirectory": stat.S_ISDIR(st.st_mode), "exists": True}, separators=(',', ':')))
except FileNotFoundError:
    print(json.dumps({"exists": False}, separators=(',', ':')))
`);
        const row = parseJsonLine(await this.execText(code, `stat ${relPath}`), { exists: false });
        if (!row.exists) return null;
        return {
            path: (0, pathSafety_1.normalizeRelativePath)(relPath),
            size: Number(row.size) || 0,
            mtime: Number(row.mtime) || 0,
            isDirectory: Boolean(row.isDirectory),
        };
    }

    async read(relPath) {
        const p = this.absolute(relPath);
        const code = this.language === "r" ? rCode(`
p <- ${rStr(p)}
if (!file.exists(p) || dir.exists(p)) {
  cat(${rStr("__COLABSYNC_NOT_FOUND__")}, "\\n", sep = "")
} else {
  cat(${rStr("__COLABSYNC_BEGIN__")}, "\\n", sep = "")
  con <- file(p, "rb")
  on.exit(close(con), add = TRUE)
  repeat {
    chunk <- readBin(con, "raw", n = ${READ_CHUNK})
    if (length(chunk) == 0) break
    cat(jsonlite::base64_enc(chunk), "\\n", sep = "")
  }
  cat(${rStr("__COLABSYNC_END__")}, "\\n", sep = "")
}
`) : python(`
import base64, os
p = ${py(p)}
if not os.path.isfile(p):
    print(${py("__COLABSYNC_NOT_FOUND__")})
else:
    print(${py("__COLABSYNC_BEGIN__")})
    with open(p, 'rb') as f:
        while True:
            chunk = f.read(${READ_CHUNK})
            if not chunk:
                break
            print(base64.b64encode(chunk).decode('ascii'))
    print(${py("__COLABSYNC_END__")})
`);
        const text = await this.execText(code, `read ${relPath}`);
        if (text.includes("__COLABSYNC_NOT_FOUND__")) {
            throw new remoteFileSystem_1.RemoteNotFoundError(`No such remote file: ${relPath}`, relPath);
        }
        const lines = text.split(/\r?\n/);
        const begin = lines.indexOf("__COLABSYNC_BEGIN__");
        const end = lines.indexOf("__COLABSYNC_END__");
        if (begin < 0 || end < begin) {
            throw new Error(`Invalid ColabSync read response for ${relPath}`);
        }
        const chunks = [];
        for (const line of lines.slice(begin + 1, end)) {
            const s = line.trim();
            if (s) chunks.push(Buffer.from(s, "base64"));
        }
        return Buffer.concat(chunks);
    }

    async write(relPath, content) {
        const rel = (0, pathSafety_1.normalizeRelativePath)(relPath);
        const target = this.absolute(rel);
        const parent = path.posix.dirname(target);
        const b64 = content.toString("base64");

        if (content.length <= INLINE_WRITE_LIMIT) {
            const code = this.language === "r" ? rCode(`
parent <- ${rStr(parent)}
target <- ${rStr(target)}
dir.create(parent, recursive = TRUE, showWarnings = FALSE)
raw <- jsonlite::base64_dec(${rStr(b64)})
temp_path <- tempfile(pattern = ".colabsync-", tmpdir = parent)
writeBin(raw, temp_path, useBytes = TRUE)
ok <- file.rename(temp_path, target)
if (!ok) {
  if (file.exists(target)) unlink(target, force = TRUE)
  ok <- file.rename(temp_path, target)
}
if (!ok) stop("Unable to replace target file")
info <- file.info(target, extra_cols = FALSE)
payload <- list(size = as.numeric(info$size), mtime = as.numeric(info$mtime) * 1000)
cat(jsonlite::toJSON(payload, auto_unbox = TRUE, digits = NA, pretty = FALSE), "\\n", sep = "")
`) : python(`
import base64, json, os, tempfile
parent = ${py(parent)}
target = ${py(target)}
os.makedirs(parent, exist_ok=True)
fd, temp_path = tempfile.mkstemp(prefix='.colabsync-', suffix=${py(PART_SUFFIX)}, dir=parent)
try:
    with os.fdopen(fd, 'wb') as f:
        f.write(base64.b64decode(${py(b64)}))
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp_path, target)
finally:
    try:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
    except OSError:
        pass
st = os.stat(target, follow_symlinks=False)
print(json.dumps({"size": int(st.st_size), "mtime": int(st.st_mtime * 1000)}, separators=(',', ':')))
`);
            const row = parseJsonLine(await this.execText(code, `write ${rel}`), null);
            if (!row) throw new Error(`Invalid write response for ${rel}`);
            return { mtime: Number(row.mtime) || Date.now(), size: Number(row.size) || content.length };
        }

        const beginCode = this.language === "r" ? rCode(`
parent <- ${rStr(parent)}
target <- ${rStr(target)}
dir.create(parent, recursive = TRUE, showWarnings = FALSE)
temp_path <- tempfile(pattern = ".colabsync-", tmpdir = parent)
file.create(temp_path)
cat(jsonlite::toJSON(list(temp = temp_path), auto_unbox = TRUE, digits = NA, pretty = FALSE), "\\n", sep = "")
`) : python(`
import os, tempfile, json
parent = ${py(parent)}
target = ${py(target)}
os.makedirs(parent, exist_ok=True)
fd, temp_path = tempfile.mkstemp(prefix='.colabsync-', suffix=${py(PART_SUFFIX)}, dir=parent)
os.close(fd)
print(json.dumps({"temp": temp_path}, separators=(',', ':')))
`);
        const begin = parseJsonLine(await this.execText(beginCode, `begin write ${rel}`), null);
        if (!begin?.temp) throw new Error(`Unable to create temporary remote file for ${rel}`);
        const tempPath = begin.temp;
        try {
            for (let offset = 0; offset < content.length; offset += WRITE_CHUNK) {
                const chunk = content.subarray(offset, Math.min(content.length, offset + WRITE_CHUNK));
                const chunkB64 = chunk.toString("base64");
                const code = this.language === "r" ? rCode(`
raw <- jsonlite::base64_dec(${rStr(chunkB64)})
con <- file(${rStr(tempPath)}, "ab")
writeBin(raw, con, useBytes = TRUE)
close(con)
`) : python(`
import base64
with open(${py(tempPath)}, 'ab') as f:
    f.write(base64.b64decode(${py(chunkB64)}))
`);
                await this.execText(code, `append ${rel} ${offset}`);
            }
            const finishCode = this.language === "r" ? rCode(`
temp_path <- ${rStr(tempPath)}
target <- ${rStr(target)}
ok <- file.rename(temp_path, target)
if (!ok) {
  if (file.exists(target)) unlink(target, force = TRUE)
  ok <- file.rename(temp_path, target)
}
if (!ok) stop("Unable to finalize target file")
info <- file.info(target, extra_cols = FALSE)
cat(jsonlite::toJSON(list(size = as.numeric(info$size), mtime = as.numeric(info$mtime) * 1000), auto_unbox = TRUE, digits = NA, pretty = FALSE), "\\n", sep = "")
`) : python(`
import json, os
temp_path = ${py(tempPath)}
target = ${py(target)}
os.replace(temp_path, target)
st = os.stat(target, follow_symlinks=False)
print(json.dumps({"size": int(st.st_size), "mtime": int(st.st_mtime * 1000)}, separators=(',', ':')))
`);
            const row = parseJsonLine(await this.execText(finishCode, `finish write ${rel}`), null);
            if (!row) throw new Error(`Invalid final write response for ${rel}`);
            return { mtime: Number(row.mtime) || Date.now(), size: Number(row.size) || content.length };
        }
        catch (error) {
            const cleanupCode = this.language === "r" ? rCode(`
if (file.exists(${rStr(tempPath)})) unlink(${rStr(tempPath)}, force = TRUE)
`) : python(`
import os
try:
    if os.path.exists(${py(tempPath)}):
        os.unlink(${py(tempPath)})
except OSError:
    pass
`);
            await this.execText(cleanupCode, `cleanup ${rel}`).catch(() => undefined);
            throw error;
        }
    }

    async delete(relPath) {
        const p = this.absolute(relPath);
        const code = this.language === "r" ? rCode(`
p <- ${rStr(p)}
if (!file.exists(p) && !dir.exists(p)) {
  cat(${rStr("__COLABSYNC_NOT_FOUND__")}, "\\n", sep = "")
} else {
  unlink(p, recursive = TRUE, force = TRUE)
  cat(${rStr("OK")}, "\\n", sep = "")
}
`) : python(`
import os, shutil
p = ${py(p)}
try:
    if os.path.isdir(p) and not os.path.islink(p):
        shutil.rmtree(p)
    else:
        os.unlink(p)
    print(${py("OK")})
except FileNotFoundError:
    print(${py("__COLABSYNC_NOT_FOUND__")})
`);
        const text = await this.execText(code, `delete ${relPath}`);
        if (text.includes("__COLABSYNC_NOT_FOUND__")) {
            throw new remoteFileSystem_1.RemoteNotFoundError(`No such remote file: ${relPath}`, relPath);
        }
    }

    async mkdir(relPath) {
        const p = this.absolute(relPath);
        const code = this.language === "r" ? rCode(`
dir.create(${rStr(p)}, recursive = TRUE, showWarnings = FALSE)
cat(${rStr("OK")}, "\\n", sep = "")
`) : python(`
import os
os.makedirs(${py(p)}, exist_ok=True)
print(${py("OK")})
`);
        await this.execText(code, `mkdir ${relPath}`);
    }

    async ping() {
        try {
            const code = this.language === "r" ? rCode(`cat("COLABSYNC_PING_OK\\n")`) : "print('COLABSYNC_PING_OK')";
            const text = await this.execText(code, "ping");
            return text.includes("COLABSYNC_PING_OK");
        }
        catch {
            return false;
        }
    }

    async rootExists() {
        const code = this.language === "r" ? rCode(`cat(if (dir.exists(${rStr(this.remoteRoot)})) "1\\n" else "0\\n")`) : python(`
import os
print(${py("1")} if os.path.isdir(${py(this.remoteRoot)}) else ${py("0")})
`);
        const text = await this.execText(code, "rootExists");
        return /(?:^|\n)1(?:\n|$)/.test(text.trim());
    }

    /** Create project root and make it the active working directory. */
    async ensureProjectRoot() {
        const root = this.remoteRoot;
        const code = this.language === "r" ? rCode(`
dir.create(${rStr(root)}, recursive = TRUE, showWarnings = FALSE)
setwd(${rStr(root)})
cat(${rStr("__COLABSYNC_CWD__")}, getwd(), "\\n", sep = "")
`) : python(`
import os
root = ${py(root)}
os.makedirs(root, exist_ok=True)
os.chdir(root)
print(${py("__COLABSYNC_CWD__")} + os.getcwd())
`);
        const text = await this.execText(code, "ensureProjectRoot");
        const marker = "__COLABSYNC_CWD__";
        const idx = text.lastIndexOf(marker);
        if (idx >= 0) {
            const cwd = text.slice(idx + marker.length).trim().split(/\r?\n/)[0];
            if (cwd) this.logger.info?.(`Colab kernel working directory set to ${cwd}`);
        }
    }

    absolute(relPath) {
        if (relPath === "") return this.remoteRoot;
        const rel = (0, pathSafety_1.normalizeRelativePath)(relPath);
        return (0, pathSafety_1.joinRemotePath)(this.remoteRoot, rel);
    }

    async execText(code, operation) {
        const run = this.executionTail.then(() => this.execTextUnlocked(code, operation));
        this.executionTail = run.catch(() => undefined);
        return run;
    }

    async execTextUnlocked(code, operation) {
        const kernel = await this.getKernel();
        if (!kernel) throw new Error(`The notebook kernel is no longer active while performing ${operation}`);
        const chunks = [];
        let sawError = false;
        const tokenSource = new vscode.CancellationTokenSource();
        try {
            for await (const batch of kernel.executeCode(code, tokenSource.token)) {
                for (const item of batch?.items ?? []) {
                    const mime = typeof item?.mime === "string" ? item.mime : "";
                    const data = item?.data;
                    if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data)) continue;
                    const text = Buffer.from(data).toString("utf8");
                    if (mime === ERROR_MIME || mime.includes("error")) {
                        sawError = true;
                        chunks.push(text);
                    }
                    else if (TEXT_MIMES.has(mime) || mime.includes("stdout") || mime.startsWith("text/")) {
                        chunks.push(text);
                    }
                }
            }
        }
        catch (error) {
            this.logger.error?.(`Kernel operation failed (${operation}): ${error?.message ?? String(error)}`);
            throw error;
        }
        finally {
            tokenSource.dispose();
        }
        const text = chunks.join("");
        if (sawError) {
            const cleaned = text.slice(-1500).trim();
            throw new Error(`Colab kernel operation failed (${operation})${cleaned ? `: ${cleaned}` : ""}`);
        }
        return text;
    }
}
exports.ColabKernelFileSystem = ColabKernelFileSystem;

function py(value) {
    return JSON.stringify(value);
}
function rStr(value) {
    return JSON.stringify(String(value));
}
function python(body) {
    return body.trim();
}
function rCode(body) {
    return body.trim();
}
function parseJsonLine(text, fallback) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
        try {
            return JSON.parse(lines[i]);
        }
        catch {
            // ignore non-JSON noise from the execution channel
        }
    }
    return fallback;
}
