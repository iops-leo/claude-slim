import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { TokenCache } from './types.js';

let encoder: { encode: (text: string) => number[] } | null = null;
let useFallback = false;

const CACHE_PATH = join(homedir(), '.claude', 'skills.disabled', '.token-cache.json');
let cache: TokenCache = { version: 1, entries: {} };
let cacheDirty = false;

export async function initTokenizer(): Promise<void> {
  try {
    const { encodingForModel } = await import('js-tiktoken');
    encoder = encodingForModel('gpt-4o') as { encode: (text: string) => number[] };
  } catch {
    useFallback = true;
  }

  try {
    const raw = await readFile(CACHE_PATH, 'utf-8');
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
  try {
    await mkdir(dirname(CACHE_PATH), { recursive: true });
    await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // Non-critical
  }
}

export function isUsingFallback(): boolean {
  return useFallback;
}
