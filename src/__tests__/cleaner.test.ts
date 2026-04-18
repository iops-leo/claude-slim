import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { cleanIssues, restoreItem } from '../cleaner.js';
import { readManifest } from '../manifest.js';
import {
  createTmpClaude,
  writeBrokenSymlink,
  writeSkill,
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
