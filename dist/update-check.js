import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClaudeDir } from './paths.js';
// Version-drift detection.
//
// Running an outdated claude-slim is not a cosmetic problem: v2.8.0 corrected
// a startup estimate that earlier versions inflated ~8x, so a stale install
// reports numbers that are simply wrong. Nothing told users they were behind —
// this module closes that gap.
//
// It only *detects*. Updating is the package manager's job (`claude plugin
// update`, `npm update -g`), and claude-slim writing into a directory the
// plugin manager owns would be a good way to corrupt an install.
//
// NETWORK: this is the only outbound request claude-slim makes, and it is never
// issued by `scan`/`clean`. It runs when the user explicitly asks (`doctor`,
// `check-update`), fails open on any error, and caches for a day so repeated
// invocations do not hammer the registry.
const REGISTRY_URL = 'https://registry.npmjs.org/claude-slim/latest';
const FETCH_TIMEOUT_MS = 2500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
function getCachePath() {
    return join(getClaudeDir(), '.claude-slim-update-check.json');
}
/**
 * Compare dotted numeric versions. Returns >0 if a is newer, <0 if b is newer.
 * Pre-release suffixes (`-beta.1`) sort below the same release, matching semver
 * closely enough for "is there something newer" without pulling in a dep.
 */
export function compareVersions(a, b) {
    const split = (v) => {
        const [core, ...rest] = v.trim().replace(/^v/, '').split('-');
        return [core.split('.').map((n) => Number.parseInt(n, 10) || 0), rest.join('-')];
    };
    const [aNums, aPre] = split(a);
    const [bNums, bPre] = split(b);
    for (let i = 0; i < Math.max(aNums.length, bNums.length); i++) {
        const diff = (aNums[i] ?? 0) - (bNums[i] ?? 0);
        if (diff !== 0)
            return diff;
    }
    if (aPre === bPre)
        return 0;
    if (!aPre)
        return 1;
    if (!bPre)
        return -1;
    return aPre < bPre ? -1 : 1;
}
/**
 * Infer how this copy was installed from where it sits on disk, so the hint we
 * print is the command that will actually work for this user.
 */
export function detectInstallMethod(modulePath) {
    const p = modulePath.replace(/\\/g, '/');
    if (p.includes('/.claude/plugins/'))
        return 'plugin';
    if (p.includes('/_npx/'))
        return 'npx';
    if (/\/(lib\/)?node_modules\/claude-slim\//.test(p))
        return 'global';
    if (p.includes('/dist/') || p.includes('/src/'))
        return 'source';
    return 'unknown';
}
export function upgradeCommandFor(method) {
    switch (method) {
        case 'plugin':
            // `claude plugin update <name>` resolves plugin@marketplace ids; the bare
            // name fails when the marketplace shares the plugin's name.
            return 'claude plugin marketplace update claude-slim && claude plugin update claude-slim@claude-slim';
        case 'global':
            return 'npm install -g claude-slim@latest';
        case 'npx':
            // npx resolves latest per invocation, but a cached older copy can stick.
            return 'npx claude-slim@latest';
        case 'source':
            return 'git pull && npm install';
        default:
            return null;
    }
}
export function getInstalledVersion() {
    try {
        const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
async function fetchLatestFromRegistry() {
    try {
        const res = await fetch(REGISTRY_URL, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { accept: 'application/json' },
        });
        if (!res.ok)
            return null;
        const body = (await res.json());
        return typeof body.version === 'string' ? body.version : null;
    }
    catch {
        // Offline, DNS failure, timeout, proxy, malformed JSON — all fail open.
        return null;
    }
}
async function readCache(path, now, ttlMs) {
    try {
        const parsed = JSON.parse(await readFile(path, 'utf-8'));
        if (parsed.version !== 1)
            return undefined;
        if (now - parsed.checkedAt > ttlMs)
            return undefined;
        return parsed.latest;
    }
    catch {
        return undefined;
    }
}
async function writeCache(path, now, latest) {
    const tmp = `${path}.tmp`;
    try {
        await mkdir(dirname(path), { recursive: true });
        const body = { version: 1, checkedAt: now, latest };
        await writeFile(tmp, JSON.stringify(body));
        await rename(tmp, path);
    }
    catch {
        // A cache we cannot persist just means the next run checks again.
    }
}
export async function checkForUpdate(opts = {}) {
    const installed = opts.installed ?? getInstalledVersion();
    const modulePath = opts.modulePath ?? fileURLToPath(import.meta.url);
    const installMethod = detectInstallMethod(modulePath);
    const cachePath = opts.cachePath ?? getCachePath();
    const now = opts.now ?? Date.now();
    const ttlMs = opts.ttlMs ?? CACHE_TTL_MS;
    const fetchLatest = opts.fetchLatest ?? fetchLatestFromRegistry;
    let latest;
    let fromCache = false;
    if (!opts.force) {
        latest = await readCache(cachePath, now, ttlMs);
        fromCache = latest !== undefined;
    }
    if (latest === undefined) {
        // Defensive at the boundary: the built-in lookup already fails open, but a
        // version check must never be able to take down `doctor`, whatever the
        // injected fetcher does.
        try {
            latest = await fetchLatest();
        }
        catch {
            latest = null;
        }
        await writeCache(cachePath, now, latest);
    }
    return {
        installed,
        latest: latest ?? null,
        outdated: latest != null && compareVersions(latest, installed) > 0,
        installMethod,
        upgradeCommand: upgradeCommandFor(installMethod),
        fromCache,
    };
}
/** One-line human summary; null when there is nothing worth saying. */
export function formatUpdateNotice(result) {
    if (!result.outdated || result.latest === null)
        return null;
    const cmd = result.upgradeCommand ? `\n  → ${result.upgradeCommand}` : '';
    return `claude-slim ${result.installed} is installed; ${result.latest} is available.${cmd}`;
}
