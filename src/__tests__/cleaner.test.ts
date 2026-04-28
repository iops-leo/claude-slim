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
  writeSymlinkDir,
  exists,
  type TmpClaude,
} from './helpers/tmp-claude.js';
import { mkdir, writeFile } from 'node:fs/promises';
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
  const skillTypes: Array<
    'template' | 'duplicate' | 'skill_dup' | 'oversized_skill' | 'unused_skill'
  > = [
    'template',
    'duplicate',
    'skill_dup',
    'oversized_skill',
    'unused_skill',
  ];

  function tierFor(type: typeof skillTypes[number]): 1 | 2 | 3 {
    if (type === 'oversized_skill' || type === 'unused_skill') return 3;
    if (type === 'duplicate') return 2;
    return 1;
  }

  for (const type of skillTypes) {
    it(`moves ${type} skill to disabled dir and restores it`, async () => {
      const skillPath = await writeSkill(tmp.skillsDir, 'my-skill', 'content here');
      const issue: Issue = {
        type,
        tier: tierFor(type),
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

describe('cleanIssues — symlink safety', () => {
  it('does not follow symlink target when deleting temp_cache', async () => {
    // Victim data sits OUTSIDE ~/.claude/ but inside the test tmp
    const victimDir = join(tmp.home, 'victim');
    await mkdir(victimDir, { recursive: true });
    await writeFile(join(victimDir, 'precious.txt'), 'do not delete');

    // Attacker plants a symlink inside ~/.claude/plugins/cache/ that points at the victim
    const linkPath = join(tmp.pluginsDir, 'temp_local_evil');
    await writeSymlinkDir(linkPath, victimDir);

    const issue: Issue = {
      type: 'temp_cache',
      tier: 1,
      name: 'temp_local_evil',
      tokens: 0,
      path: linkPath,
    };

    await cleanIssues([issue]);

    // The symlink itself should be gone
    expect(await exists(linkPath)).toBe(false);
    // But the target must NOT be touched
    expect(await exists(victimDir)).toBe(true);
    expect(await exists(join(victimDir, 'precious.txt'))).toBe(true);
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

describe('restoreItem — skill existence guards', () => {
  it('refuses to restore when target skill dir already exists', async () => {
    const skillPath = await writeSkill(tmp.skillsDir, 'collide', 'old');
    const issue: Issue = {
      type: 'template',
      tier: 1,
      name: 'collide',
      tokens: 10,
      path: skillPath,
    };
    await cleanIssues([issue]);

    // User recreated the skill with different content while it was disabled
    await writeSkill(tmp.skillsDir, 'collide', 'new-work');

    const entries = await readManifest();
    const entry = entries.find((e) => e.name === 'collide');
    await expect(restoreItem(entry!)).rejects.toThrow(/already exists/i);

    // Original (current) user work must still be intact — not silently overwritten
    const content = await (await import('node:fs/promises')).readFile(
      join(skillPath, 'SKILL.md'),
      'utf-8',
    );
    expect(content).toBe('new-work');
  });

  it('gives a clear error when backup is missing', async () => {
    const skillPath = await writeSkill(tmp.skillsDir, 'gone', 'content');
    const issue: Issue = {
      type: 'template',
      tier: 1,
      name: 'gone',
      tokens: 10,
      path: skillPath,
    };
    await cleanIssues([issue]);

    // Simulate user manually deleting the backup dir
    await (await import('node:fs/promises')).rm(
      join(tmp.disabledDir, 'gone'),
      { recursive: true, force: true },
    );

    const entries = await readManifest();
    const entry = entries.find((e) => e.name === 'gone');
    await expect(restoreItem(entry!)).rejects.toThrow(/backup/i);
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

describe('cleanIssues — path containment', () => {
  it('refuses to operate on paths outside ~/.claude/', async () => {
    // Attacker-controlled manifest or scanner bug produces a path outside the claude dir
    const outside = join(tmp.home, 'sensitive.txt');
    await (await import('node:fs/promises')).writeFile(outside, 'precious');

    const issue: Issue = {
      type: 'broken_symlink',
      tier: 1,
      name: 'evil',
      tokens: 0,
      path: outside,
    };

    const result = await cleanIssues([issue]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe('evil');
    expect(result.errors[0].error).toMatch(/outside|refus/i);
    expect(result.moved).toHaveLength(0);
    // File must still exist — guard prevented deletion
    expect(await exists(outside)).toBe(true);
  });

  it('refuses to clean temp_cache pointing outside ~/.claude/', async () => {
    const outside = join(tmp.home, 'not-claude-dir');
    await (await import('node:fs/promises')).mkdir(outside, { recursive: true });
    await (await import('node:fs/promises')).writeFile(join(outside, 'important.txt'), 'keep me');

    const issue: Issue = {
      type: 'temp_cache',
      tier: 1,
      name: 'temp_local_evil',
      tokens: 0,
      path: outside,
    };

    const result = await cleanIssues([issue]);
    expect(result.errors).toHaveLength(1);
    expect(await exists(join(outside, 'important.txt'))).toBe(true);
  });
});

describe('restoreItem — path containment', () => {
  it('refuses to restore to a path outside ~/.claude/', async () => {
    const entry = {
      date: new Date().toISOString(),
      name: 'evil',
      from: join(tmp.home, 'etc-passwd-overwrite'),
      type: 'template' as const,
      tier: 1 as const,
    };

    await expect(restoreItem(entry)).rejects.toThrow(/outside|refus/i);
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
