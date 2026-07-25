import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getClaudeDir } from './paths.js';
let encoder = null;
let useFallback = false;
// Resolved lazily so the HOME env stub used in tests is honored.
function getCachePath() {
    return join(getClaudeDir(), '.token-cache.json');
}
let cache = { version: 1, entries: {} };
let cacheDirty = false;
export async function initTokenizer() {
    // Building the cl100k_base encoder parses a large rank table — hundreds of
    // milliseconds, and far more under CPU contention. It is immutable once
    // built, so reuse it across calls. Only the cache is per-init state.
    if (encoder === null && !useFallback) {
        try {
            // cl100k_base is closest to Claude's tokenizer (gpt-4o uses o200k_base which undercounts by ~15%)
            const { getEncoding } = await import('js-tiktoken');
            encoder = getEncoding('cl100k_base');
        }
        catch {
            useFallback = true;
        }
    }
    // Reset in-memory state so repeated initTokenizer() calls (e.g. across
    // test cases) don't bleed cache entries from a prior invocation.
    cache = { version: 1, entries: {} };
    cacheDirty = false;
    try {
        const raw = await readFile(getCachePath(), 'utf-8');
        cache = JSON.parse(raw);
    }
    catch {
        // No cache yet
    }
}
function hashContent(content) {
    return createHash('md5').update(content).digest('hex');
}
export function countTokens(text) {
    if (useFallback || !encoder) {
        return Math.ceil(text.length / 4);
    }
    return encoder.encode(text).length;
}
export function countTokensCached(text, filePath) {
    const hash = hashContent(text);
    const cached = cache.entries[filePath];
    if (cached && cached.hash === hash) {
        return cached.tokens;
    }
    const tokens = countTokens(text);
    cache.entries[filePath] = { hash, tokens };
    cacheDirty = true;
    return tokens;
}
/**
 * Drop cache entries whose source file no longer exists.
 *
 * Skills get uninstalled, plugins get removed, sessions get rotated — but the
 * entry keyed by that path stayed forever, so the cache grew without bound. A
 * path that is gone can never produce a hit again, which makes existence the
 * safe pruning predicate: it cannot evict an entry that is still reachable.
 * (Measured on a real install before this fix: 355 of 776 entries were dead.)
 */
async function pruneMissingEntries() {
    const paths = Object.keys(cache.entries);
    const alive = await Promise.all(paths.map(async (p) => {
        try {
            await access(p);
            return true;
        }
        catch {
            return false;
        }
    }));
    for (let i = 0; i < paths.length; i++) {
        if (!alive[i])
            delete cache.entries[paths[i]];
    }
}
export async function flushCache() {
    if (!cacheDirty)
        return;
    await pruneMissingEntries();
    const target = getCachePath();
    const tmp = target + '.tmp';
    try {
        await mkdir(dirname(target), { recursive: true });
        // Atomic: write to a sibling tmp file first, then rename. A crash mid-write
        // leaves the prior cache (or nothing) — never a torn JSON file.
        await writeFile(tmp, JSON.stringify(cache, null, 2));
        await rename(tmp, target);
        cacheDirty = false;
    }
    catch {
        // Non-critical
    }
}
export function isUsingFallback() {
    return useFallback;
}
