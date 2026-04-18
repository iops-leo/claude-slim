import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { access } from 'node:fs/promises';
import { cleanIssues } from '../cleaner.js';
import { readManifest } from '../manifest.js';
import { createTmpClaude, writeBrokenSymlink, type TmpClaude } from './helpers/tmp-claude.js';
import type { Issue } from '../types.js';

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
});

afterEach(async () => {
  await tmp.cleanup();
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('cleanIssues — broken_symlink', () => {
  it('unlinks broken symlink and records manifest entry', async () => {
    const mdPath = await writeBrokenSymlink(tmp.skillsDir, 'dead-skill');
    const issue: Issue = {
      type: 'broken_symlink',
      tier: 1,
      name: 'dead-skill',
      tokens: 0,
      path: mdPath,
    };

    const result = await cleanIssues([issue]);

    expect(result.moved).toHaveLength(1);
    expect(result.moved[0].name).toBe('dead-skill');
    expect(result.moved[0].type).toBe('broken_symlink');
    expect(result.errors).toHaveLength(0);
    expect(await exists(mdPath)).toBe(false);

    // Manifest recorded — read via API so test survives v1→v2 migration
    const entries = await readManifest();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('dead-skill');
    expect(entries[0].type).toBe('broken_symlink');
  });
});
