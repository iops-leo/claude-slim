import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  readManifestV2,
  writeManifestV2,
  addEntry,
  removeEntry,
  migrateLegacyIfNeeded,
} from '../manifest.js';
import { createTmpClaude, exists, type TmpClaude } from './helpers/tmp-claude.js';
import type { ManifestEntry } from '../types.js';

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
});

afterEach(async () => {
  await tmp.cleanup();
});

describe('manifest v2', () => {
  it('readManifestV2 returns empty when no file exists', async () => {
    const m = await readManifestV2();
    expect(m.version).toBe(2);
    expect(m.entries).toEqual([]);
  });

  it('writeManifestV2 + readManifestV2 round-trip', async () => {
    const entry: ManifestEntry = {
      date: '2026-04-18',
      name: 'foo',
      from: '/x/foo',
      type: 'template',
      tokenCount: 100,
      tier: 1,
    };
    await writeManifestV2({ version: 2, entries: [entry] });
    const m = await readManifestV2();
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].name).toBe('foo');
  });

  it('addEntry appends to active list', async () => {
    await addEntry({ date: '2026-04-18', name: 'a', from: '/a', type: 'template' });
    await addEntry({ date: '2026-04-18', name: 'b', from: '/b', type: 'duplicate' });
    const m = await readManifestV2();
    expect(m.entries.map((e) => e.name)).toEqual(['a', 'b']);
  });

  it('removeEntry removes by name and returns removed entry', async () => {
    await addEntry({ date: '2026-04-18', name: 'a', from: '/a', type: 'template' });
    await addEntry({ date: '2026-04-18', name: 'b', from: '/b', type: 'duplicate' });

    const removed = await removeEntry('a');
    expect(removed).not.toBeNull();
    expect(removed!.name).toBe('a');

    const m = await readManifestV2();
    expect(m.entries.map((e) => e.name)).toEqual(['b']);
  });

  it('removeEntry returns null when name not found', async () => {
    const removed = await removeEntry('nothing');
    expect(removed).toBeNull();
  });

  it('migrateLegacyIfNeeded is no-op when no legacy file exists', async () => {
    await migrateLegacyIfNeeded();
    const m = await readManifestV2();
    expect(m.entries).toEqual([]);
  });

  it('migrateLegacyIfNeeded converts JSONL to JSON, drops restored entries', async () => {
    const legacyPath = join(tmp.disabledDir, '.claude-slim-manifest.jsonl');
    await mkdir(tmp.disabledDir, { recursive: true });
    const lines = [
      JSON.stringify({ date: '2026-01-01', name: 'a', from: '/a', type: 'template' }),
      JSON.stringify({ date: '2026-01-02', name: 'b', from: '/b', type: 'duplicate' }),
      JSON.stringify({ date: '2026-01-03', name: 'a', from: '/a', type: 'template', action: 'restored' }),
      JSON.stringify({ date: '2026-01-04', name: 'c', from: '/c', type: 'template' }),
    ];
    await writeFile(legacyPath, lines.join('\n') + '\n');

    await migrateLegacyIfNeeded();

    const m = await readManifestV2();
    // 'a' is restored (dropped), 'b' and 'c' remain
    expect(m.entries.map((e) => e.name).sort()).toEqual(['b', 'c']);

    // Legacy file renamed to .bak
    expect(await exists(legacyPath)).toBe(false);
    expect(await exists(legacyPath + '.bak')).toBe(true);
  });

  it('migrateLegacyIfNeeded is idempotent (safe to call multiple times)', async () => {
    await addEntry({ date: '2026-04-18', name: 'a', from: '/a', type: 'template' });
    await migrateLegacyIfNeeded(); // no legacy file, new manifest exists
    const m = await readManifestV2();
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].name).toBe('a');
  });

  it('readManifestV2 auto-triggers migration from legacy file', async () => {
    const legacyPath = join(tmp.disabledDir, '.claude-slim-manifest.jsonl');
    await mkdir(tmp.disabledDir, { recursive: true });
    await writeFile(
      legacyPath,
      JSON.stringify({ date: '2026-01-01', name: 'xyz', from: '/xyz', type: 'template' }) + '\n',
    );

    const m = await readManifestV2();
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].name).toBe('xyz');
  });
});
