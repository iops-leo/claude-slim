import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { cleanIssues, restoreItem } from '../cleaner.js';
import * as manifest from '../manifest.js';
import { readManifest, readManifestV2 } from '../manifest.js';
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
      const entry = entries.find((e) => e.name === 'my-skill');
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

describe('cleanIssues — stale_project atomicity', () => {
  it('leaves no partial state when restore would fail', async () => {
    const memDir = await writeStaleProject(tmp.projectsDir, 'partial-proj', {
      'a.md': 'aaa',
      'b.md': 'bbb',
    });
    const issue: Issue = {
      type: 'stale_project',
      tier: 2,
      name: 'partial-proj',
      tokens: 100,
      path: memDir,
    };

    await cleanIssues([issue]);

    // After atomic clean: memDir must not exist (was renamed away, not copied)
    expect(await exists(memDir)).toBe(false);

    // Backup is a directory, not a collection of individually-moved files
    const backupDir = join(tmp.disabledDir, 'memory-backup', 'partial-proj');
    expect(await exists(backupDir)).toBe(true);
    expect(await exists(join(backupDir, 'a.md'))).toBe(true);
    expect(await exists(join(backupDir, 'b.md'))).toBe(true);
  });

  it('atomic restore moves backup dir back in one operation', async () => {
    const memDir = await writeStaleProject(tmp.projectsDir, 'p2', { 'x.md': 'x' });
    const issue: Issue = {
      type: 'stale_project',
      tier: 2,
      name: 'p2',
      tokens: 10,
      path: memDir,
    };
    await cleanIssues([issue]);

    const entries = await readManifest();
    const entry = entries.find((e) => e.name === 'p2');
    await restoreItem(entry!);

    // After atomic restore: backup dir gone, memDir restored
    expect(await exists(join(tmp.disabledDir, 'memory-backup', 'p2'))).toBe(false);
    expect(await exists(memDir)).toBe(true);
    expect(await exists(join(memDir, 'x.md'))).toBe(true);
  });

  it('refuses to clean when backup already exists', async () => {
    // First clean succeeds
    const memDir = await writeStaleProject(tmp.projectsDir, 'dup-proj', { 'a.md': 'aaa' });
    const issue: Issue = {
      type: 'stale_project',
      tier: 2,
      name: 'dup-proj',
      tokens: 10,
      path: memDir,
    };
    await cleanIssues([issue]);

    // Recreate the project to simulate "it came back"
    await writeStaleProject(tmp.projectsDir, 'dup-proj', { 'a.md': 'aaa-new' });

    // Second clean should fail cleanly because backup still exists
    const result = await cleanIssues([issue]);
    expect(result.moved).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe('dup-proj');
    expect(result.errors[0].error).toMatch(/backup already exists/i);
  });

  it('refuses to restore when target memory dir already exists', async () => {
    const memDir = await writeStaleProject(tmp.projectsDir, 'conflict', { 'x.md': 'x' });
    const issue: Issue = {
      type: 'stale_project',
      tier: 2,
      name: 'conflict',
      tokens: 10,
      path: memDir,
    };
    await cleanIssues([issue]);

    // User manually recreates the memory dir before restoring
    await writeStaleProject(tmp.projectsDir, 'conflict', { 'y.md': 'y' });

    const entries = await readManifest();
    const entry = entries.find((e) => e.name === 'conflict');
    await expect(restoreItem(entry!)).rejects.toThrow(/already exists/i);
  });
});

describe('manifest bounded growth', () => {
  it('restore removes entry so manifest stays bounded across cycles', async () => {
    const skillPath = await writeSkill(tmp.skillsDir, 'cycler', 'x');
    const issue: Issue = {
      type: 'template',
      tier: 1,
      name: 'cycler',
      tokens: 10,
      path: skillPath,
    };

    // 10 clean/restore cycles
    for (let i = 0; i < 10; i++) {
      // Ensure skill dir exists before each clean (restore put it back)
      if (!(await exists(skillPath))) {
        await writeSkill(tmp.skillsDir, 'cycler', 'x');
      }
      await cleanIssues([issue]);
      const m1 = await readManifestV2();
      expect(m1.entries.filter((e) => e.name === 'cycler')).toHaveLength(1);

      const entry = m1.entries.find((e) => e.name === 'cycler')!;
      await restoreItem(entry);
      const m2 = await readManifestV2();
      expect(m2.entries.filter((e) => e.name === 'cycler')).toHaveLength(0);
    }

    // After 10 cycles, manifest should be empty (or at least not linear in cycle count)
    const final = await readManifestV2();
    expect(final.entries).toHaveLength(0);
  });
});

describe('cleanIssues — rollback on manifest failure', () => {
  it('reverses skill rename when appendManifest throws', async () => {
    const skillPath = await writeSkill(tmp.skillsDir, 'rollback-skill', 'x');
    const issue: Issue = {
      type: 'template',
      tier: 1,
      name: 'rollback-skill',
      tokens: 10,
      path: skillPath,
    };

    const spy = vi
      .spyOn(manifest, 'appendManifest')
      .mockRejectedValueOnce(new Error('manifest write blew up'));

    const result = await cleanIssues([issue]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe('rollback-skill');
    expect(result.moved).toHaveLength(0);
    // Rolled back: original path restored, disabled dir does not hold an orphan
    expect(await exists(skillPath)).toBe(true);
    expect(await exists(join(tmp.disabledDir, 'rollback-skill'))).toBe(false);

    spy.mockRestore();
  });

  it('reverses stale_project rename when appendManifest throws', async () => {
    const memDir = await writeStaleProject(tmp.projectsDir, 'myproj', { 'a.md': 'x' });
    const issue: Issue = {
      type: 'stale_project',
      tier: 2,
      name: 'myproj',
      tokens: 20,
      path: memDir,
    };

    const spy = vi
      .spyOn(manifest, 'appendManifest')
      .mockRejectedValueOnce(new Error('manifest write blew up'));

    const result = await cleanIssues([issue]);

    expect(result.errors).toHaveLength(1);
    expect(result.moved).toHaveLength(0);
    expect(await exists(memDir)).toBe(true);
    expect(await exists(join(tmp.disabledDir, 'memory-backup', 'myproj'))).toBe(false);

    spy.mockRestore();
  });
});
