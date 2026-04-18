import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { cleanIssues, restoreItem } from '../cleaner.js';
import { readManifest } from '../manifest.js';
import {
  createTmpClaude,
  writeBrokenSymlink,
  writeSkill,
  writeStaleProject,
  writeTempCache,
  exists,
  type TmpClaude,
} from './helpers/tmp-claude.js';
import type { Issue } from '../types.js';

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
});

afterEach(async () => {
  await tmp.cleanup();
});

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

describe('cleanIssues — skill directory moves', () => {
  const skillTypes: Array<'template' | 'duplicate' | 'skill_dup' | 'oversized_skill'> = [
    'template',
    'duplicate',
    'skill_dup',
    'oversized_skill',
  ];

  for (const type of skillTypes) {
    it(`moves ${type} skill to disabled dir and restores it`, async () => {
      const skillPath = await writeSkill(tmp.skillsDir, 'my-skill', 'content here');
      const issue: Issue = {
        type,
        tier: type === 'oversized_skill' ? 3 : type === 'duplicate' ? 2 : 1,
        name: 'my-skill',
        tokens: 100,
        path: skillPath,
      };

      const cleanResult = await cleanIssues([issue]);

      expect(cleanResult.moved).toHaveLength(1);
      expect(cleanResult.errors).toHaveLength(0);
      expect(await exists(skillPath)).toBe(false);
      expect(await exists(join(tmp.disabledDir, 'my-skill'))).toBe(true);

      // Round-trip restore
      const entries = await readManifest();
      const entry = entries.find((e) => e.name === 'my-skill' && e.action !== 'restored');
      expect(entry).toBeDefined();

      await restoreItem(entry!);

      expect(await exists(skillPath)).toBe(true);
      expect(await exists(join(skillPath, 'SKILL.md'))).toBe(true);
      expect(await exists(join(tmp.disabledDir, 'my-skill'))).toBe(false);
    });
  }

  it('preserves nested skill names with slash replacement', async () => {
    const skillPath = await writeSkill(tmp.skillsDir, 'gstack/ship', 'nested skill');
    const issue: Issue = {
      type: 'duplicate',
      tier: 2,
      name: 'gstack/ship',
      tokens: 100,
      path: skillPath,
    };

    await cleanIssues([issue]);

    // Disabled dir uses -- separator (cleaner.ts:44)
    expect(await exists(join(tmp.disabledDir, 'gstack--ship'))).toBe(true);

    const entries = await readManifest();
    const entry = entries.find((e) => e.name === 'gstack/ship');
    await restoreItem(entry!);

    expect(await exists(skillPath)).toBe(true);
  });
});

describe('cleanIssues — temp_cache', () => {
  it('deletes temp cache directory and records manifest', async () => {
    const cachePath = await writeTempCache(tmp.pluginsDir, 'temp_local_abc123');
    const issue: Issue = {
      type: 'temp_cache',
      tier: 1,
      name: 'temp_local_abc123',
      detail: '12KB',
      tokens: 0,
      path: cachePath,
    };

    const result = await cleanIssues([issue]);

    expect(result.moved).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(await exists(cachePath)).toBe(false);
  });

  it('restore throws for temp_cache (not recoverable)', async () => {
    const cachePath = await writeTempCache(tmp.pluginsDir, 'temp_local_xyz');
    const issue: Issue = {
      type: 'temp_cache',
      tier: 1,
      name: 'temp_local_xyz',
      tokens: 0,
      path: cachePath,
    };
    await cleanIssues([issue]);

    const entries = await readManifest();
    const entry = entries.find((e) => e.name === 'temp_local_xyz');
    expect(entry).toBeDefined();

    await expect(restoreItem(entry!)).rejects.toThrow(/temp cache/i);
  });
});

describe('cleanIssues — stale_project', () => {
  it('moves memory files to backup and restores them', async () => {
    const memDir = await writeStaleProject(tmp.projectsDir, 'old-proj', {
      'file1.md': 'content one',
      'file2.md': 'content two',
    });
    const issue: Issue = {
      type: 'stale_project',
      tier: 2,
      name: 'old-proj',
      detail: '100d, 2 files, 1KB',
      tokens: 200,
      path: memDir,
    };

    const cleanResult = await cleanIssues([issue]);
    expect(cleanResult.moved).toHaveLength(1);

    // Current impl: files moved into memory-backup/<name>/
    const backupDir = join(tmp.disabledDir, 'memory-backup', 'old-proj');
    expect(await exists(join(backupDir, 'file1.md'))).toBe(true);
    expect(await exists(join(backupDir, 'file2.md'))).toBe(true);

    // Restore
    const entries = await readManifest();
    const entry = entries.find((e) => e.name === 'old-proj');
    await restoreItem(entry!);

    expect(await exists(join(memDir, 'file1.md'))).toBe(true);
    expect(await exists(join(memDir, 'file2.md'))).toBe(true);
    const restored = await readFile(join(memDir, 'file1.md'), 'utf-8');
    expect(restored).toBe('content one');
  });
});
