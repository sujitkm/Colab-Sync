"use strict";
/**
 * Include/exclude glob matching for sync filtering.
 *
 * Implements a focused subset of gitignore-style globs sufficient for project
 * configuration without pulling in a dependency:
 *   `*`      any characters except `/`
 *   `**`     any characters including `/` (zero or more path segments)
 *   `?`      one character except `/`
 *   `a/**`   everything under directory `a`
 *   `*.log`  basename match at any depth
 *
 * A path is synchronized when it matches at least one include pattern and no
 * exclude pattern.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IgnoreRules = void 0;
function globToRegExp(glob) {
    let g = glob.trim();
    if (g.startsWith('./')) {
        g = g.slice(2);
    }
    let re = '';
    let i = 0;
    const n = g.length;
    while (i < n) {
        const c = g[i];
        if (c === '*') {
            if (g[i + 1] === '*') {
                // `**` — crosses directory boundaries.
                if (g[i + 2] === '/') {
                    re += '(?:[^/]+/)*';
                    i += 3;
                }
                else {
                    re += '.*';
                    i += 2;
                }
            }
            else {
                re += '[^/]*';
                i += 1;
            }
        }
        else if (c === '?') {
            re += '[^/]';
            i += 1;
        }
        else if ('\\^$.|+()[]{}'.includes(c)) {
            re += '\\' + c;
            i += 1;
        }
        else {
            re += c;
            i += 1;
        }
    }
    return new RegExp(`^${re}$`);
}
class IgnoreRules {
    includeRes;
    excludeRes;
    constructor(include, exclude) {
        this.includeRes = include.map(globToRegExp);
        this.excludeRes = exclude.map(globToRegExp);
    }
    /** True when the relative POSIX path should be synchronized. */
    isIncluded(relPath) {
        const p = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
        if (this.isExcluded(p)) {
            return false;
        }
        if (this.includeRes.length === 0) {
            return true;
        }
        return this.includeRes.some((re) => re.test(p) || re.test(baseOf(p)));
    }
    /** True when the path matches any exclude pattern. */
    isExcluded(relPath) {
        const p = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
        return this.excludeRes.some((re) => re.test(p) || re.test(baseOf(p)));
    }
}
exports.IgnoreRules = IgnoreRules;
function baseOf(p) {
    const idx = p.lastIndexOf('/');
    return idx === -1 ? p : p.slice(idx + 1);
}
//# sourceMappingURL=ignore.js.map