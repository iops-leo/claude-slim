import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { addEntry, readManifestV2, ManifestCorruptError } from '../manifest.js';
import { cleanIssues } from '../cleaner.js';
import { createTmpClaude, writeSkill, exists, type TmpClaude } from './helpers/tmp-claude.js';

/**
 * A manifest that fails to parse was read as empty and then overwritten by
 * the next write — silently destroying the only record of what clean moved
 * and how to put it back.
 */

let tmp: TmpClaude;
let manifestPath: string;
const GARBAGE = '{"version": 2, "entries": [ {"name": "foo", trunc';

beforeEach(async () => {
  tmp = await createTmpClaude();
  await mkdir(tmp.disabledDir, { recursive: true });
  manifestPath = join(tmp.disabledDir, 'manifest.json');
  await writeFile(manifestPath, GARBAGE);
});
afterEach(async () => { await tmp.cleanup(); });

async function corruptCopies(): Promise<string[]> {
  return (await readdir(tmp.disabledDir)).filter((f) => f.startsWith('manifest.json.corrupt-'));
}

describe('corrupt manifest', () => {
  it('refuses to read it as empty and keeps a copy', async () => {
    await expect(readManifestV2()).rejects.toBeInstanceOf(ManifestCorruptError);
    const copies = await corruptCopies();
    expect(copies).toHaveLength(1);
    expect(await readFile(join(tmp.disabledDir, copies[0]), 'utf-8')).toBe(GARBAGE);
  });

  it('never overwrites it', async () => {
    await expect(
      addEntry({ date: 'd', name: 'x', from: '/x', type: 'template' }),
    ).rejects.toThrow(/manifest/i);
    expect(await readFile(manifestPath, 'utf-8')).toBe(GARBAGE);
  });

  it('a valid JSON file of the wrong shape counts as corrupt too', async () => {
    await writeFile(manifestPath, '[]');
    await expect(readManifestV2()).rejects.toBeInstanceOf(ManifestCorruptError);
    expect(await readFile(manifestPath, 'utf-8')).toBe('[]');
  });

  it('clean moves nothing while the manifest is unreadable', async () => {
    const skill = await writeSkill(tmp.skillsDir, 'foo', 'x');
    await expect(
      cleanIssues([{ type: 'unused_skill', tier: 3, name: 'foo', tokens: 1, path: skill }]),
    ).rejects.toBeInstanceOf(ManifestCorruptError);
    expect(await exists(join(skill, 'SKILL.md'))).toBe(true);
    expect(await readFile(manifestPath, 'utf-8')).toBe(GARBAGE);
  });

  it('a missing manifest is still simply empty', async () => {
    await writeFile(manifestPath, '');
    const { rm } = await import('node:fs/promises');
    await rm(manifestPath);
    expect((await readManifestV2()).entries).toEqual([]);
  });
});
