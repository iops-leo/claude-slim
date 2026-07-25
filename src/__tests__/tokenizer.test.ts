import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, readdir, writeFile, rm } from 'node:fs/promises';
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

describe('flushCache — pruning entries for deleted files', () => {
  it('drops entries whose source file no longer exists', async () => {
    await initTokenizer();

    const livePath = join(tmp.claudeDir, 'live.md');
    await writeFile(livePath, 'still here');
    countTokensCached('still here', livePath);
    countTokensCached('long gone', join(tmp.claudeDir, 'deleted.md'));

    await flushCache();

    const parsed = JSON.parse(
      await readFile(join(getClaudeDir(), '.token-cache.json'), 'utf-8'),
    );
    expect(Object.keys(parsed.entries)).toEqual([livePath]);
  });

  it('drops an entry once its file is removed between scans', async () => {
    await initTokenizer();
    const doomed = join(tmp.claudeDir, 'doomed.md');
    await writeFile(doomed, 'here for now');
    countTokensCached('here for now', doomed);
    await flushCache();

    // Entry survives the first flush while the file exists.
    let parsed = JSON.parse(
      await readFile(join(getClaudeDir(), '.token-cache.json'), 'utf-8'),
    );
    expect(Object.keys(parsed.entries)).toContain(doomed);

    // Uninstall the skill, then run another scan that touches something else.
    await rm(doomed);
    const other = join(tmp.claudeDir, 'other.md');
    await writeFile(other, 'new content');
    countTokensCached('new content', other);
    await flushCache();

    parsed = JSON.parse(
      await readFile(join(getClaudeDir(), '.token-cache.json'), 'utf-8'),
    );
    expect(Object.keys(parsed.entries)).not.toContain(doomed);
    expect(Object.keys(parsed.entries)).toContain(other);
  });

  it('keeps every entry when all source files still exist', async () => {
    await initTokenizer();
    const paths = [];
    for (const name of ['a.md', 'b.md', 'c.md']) {
      const p = join(tmp.claudeDir, name);
      await writeFile(p, `content of ${name}`);
      countTokensCached(`content of ${name}`, p);
      paths.push(p);
    }

    await flushCache();

    const parsed = JSON.parse(
      await readFile(join(getClaudeDir(), '.token-cache.json'), 'utf-8'),
    );
    expect(Object.keys(parsed.entries).sort()).toEqual(paths.sort());
  });
});
