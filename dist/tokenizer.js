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
// js-tiktoken's BPE is quadratic in the length of a single whitespace-free run.
// Ordinary prose of any length is fine — the pre-tokenizer splits on whitespace,
// so 8,000 characters of normal text encodes in ~1ms. One long unbroken run does
// not: measured on cl100k_base, 800 characters of Hangul costs ~450ms, 3,200
// costs ~6.8s, and a 60,000-character run wedges the scan for minutes with no
// output at all. Real SKILL.md files reach this with base64 blobs, minified
// snippets, rule separators, and CJK text.
//
// 512 sits above anything a normal word, path, or URL produces and well below
// where the curve turns painful.
const MAX_ENCODE_RUN = 512;
const LONG_RUN_PATTERN = /\S{513,}/;
const FALLBACK_CHARS_PER_TOKEN = 4;
/**
 * Estimate an over-long run by encoding a bounded prefix and scaling.
 *
 * A fixed characters-per-token divisor cannot work here: measured over 1,000-char
 * runs, cl100k_base yields 0.8 chars/token for Hangul but 8.0 for a repeated
 * ASCII character — a 10× spread. Sampling the run's own prefix adapts to
 * whatever it actually contains (base64, hex, minified JSON, CJK) at the cost of
 * exactly one bounded encode.
 */
function estimateRun(segment, encode) {
    const sample = segment.slice(0, MAX_ENCODE_RUN);
    const sampleTokens = encode(sample).length;
    if (sampleTokens === 0)
        return 0;
    return Math.ceil((sampleTokens * segment.length) / sample.length);
}
/**
 * Encode `text`, estimating any whitespace-free run longer than
 * {@link MAX_ENCODE_RUN} instead of feeding the whole run to the BPE.
 *
 * Text without such a run takes the fast path and is encoded whole, so counts
 * for well-formed files are identical to encoding directly.
 */
function encodeBounded(text, encode) {
    if (!LONG_RUN_PATTERN.test(text)) {
        return encode(text).length;
    }
    let total = 0;
    let buffered = '';
    // Splitting on a captured group keeps the whitespace in the stream, so the
    // buffered pieces still look to the encoder like the original text.
    for (const segment of text.split(/(\s+)/)) {
        if (segment.length > MAX_ENCODE_RUN) {
            if (buffered) {
                total += encode(buffered).length;
                buffered = '';
            }
            total += estimateRun(segment, encode);
            continue;
        }
        buffered += segment;
    }
    if (buffered) {
        total += encode(buffered).length;
    }
    return total;
}
export function countTokens(text) {
    if (useFallback || !encoder) {
        return Math.ceil(text.length / FALLBACK_CHARS_PER_TOKEN);
    }
    const enc = encoder;
    return encodeBounded(text, (s) => enc.encode(s));
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
