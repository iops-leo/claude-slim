import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getClaudeDir } from './paths.js';
import type { TokenCache } from './types.js';

let encoder: { encode: (text: string) => number[] } | null = null;
let useFallback = false;

// Resolved lazily so the HOME env stub used in tests is honored.
function getCachePath(): string {
  return join(getClaudeDir(), '.token-cache.json');
}

let cache: TokenCache = { version: 1, entries: {} };
let cacheDirty = false;

export async function initTokenizer(): Promise<void> {
  try {
    // cl100k_base is closest to Claude's tokenizer (gpt-4o uses o200k_base which undercounts by ~15%)
    const { getEncoding } = await import('js-tiktoken');
    encoder = getEncoding('cl100k_base') as { encode: (text: string) => number[] };
  } catch {
    useFallback = true;
  }

  // Reset in-memory state so repeated initTokenizer() calls (e.g. across
  // test cases) don't bleed cache entries from a prior invocation.
  cache = { version: 1, entries: {} };
  cacheDirty = false;
  try {
    const raw = await readFile(getCachePath(), 'utf-8');
    cache = JSON.parse(raw);
  } catch {
    // No cache yet
  }
}

function hashContent(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

export function countTokens(text: string): number {
  if (useFallback || !encoder) {
    return Math.ceil(text.length / 4);
  }
  return encoder.encode(text).length;
}

export function countTokensCached(text: string, filePath: string): number {
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

export async function flushCache(): Promise<void> {
  if (!cacheDirty) return;
  const target = getCachePath();
  const tmp = target + '.tmp';
  try {
    await mkdir(dirname(target), { recursive: true });
    // Atomic: write to a sibling tmp file first, then rename. A crash mid-write
    // leaves the prior cache (or nothing) — never a torn JSON file.
    await writeFile(tmp, JSON.stringify(cache, null, 2));
    await rename(tmp, target);
    cacheDirty = false;
  } catch {
    // Non-critical
  }
}

export function isUsingFallback(): boolean {
  return useFallback;
}
