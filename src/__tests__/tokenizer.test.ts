import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { initTokenizer, countTokensCached, flushCache } from '../tokenizer.js';
import { getClaudeDir } from '../paths.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
});

afterEach(async () => {
  await tmp.cleanup();
});

describe('flushCache — atomic write', () => {
  it('produces a valid JSON cache file and leaves no .tmp residue', async () => {
    await initTokenizer();
    countTokensCached('hello world', '/fake/a.md');
    countTokensCached('another file', '/fake/b.md');

    await flushCache();

    const cachePath = join(getClaudeDir(), '.token-cache.json');
    const content = await readFile(cachePath, 'utf-8');
    // Must parse as valid JSON — no torn/partial write
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe(1);
    expect(typeof parsed.entries).toBe('object');

    // No stale .tmp files hanging around next to the cache
    const claudeEntries = await readdir(getClaudeDir());
    expect(claudeEntries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });
});
