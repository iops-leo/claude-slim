import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, symlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanIssues, restoreItem } from '../cleaner.js';
import { readManifest } from '../manifest.js';
import type { ManifestEntry } from '../types.js';
import { createTmpClaude, exists, type TmpClaude } from './helpers/tmp-claude.js';

/**
 * The path guard was lexical: `skills/group -> /ext-repo/group` let clean move
 * `/ext-repo/group/a`, a directory outside every root claude-slim manages.
 * The parent's real path must sit inside a managed root's real path. Moving a
 * symlink entry itself is fine — that moves the link, not what it points at.
 */

let tmp: TmpClaude;
let ext: string;

beforeEach(async () => {
  tmp = await createTmpClaude();
  ext = join(tmp.home, 'ext-repo');
  await mkdir(ext, { recursive: true });
});
afterEach(async () => { await tmp.cleanup(); });

async function skillAt(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), 'x');
}

describe('clean refuses paths that resolve outside managed roots', () => {
  it('does not move a skill through a symlinked parent directory', async () => {
    await skillAt(join(ext, 'group', 'a'));
    await symlink(join(ext, 'group'), join(tmp.skillsDir, 'group'));
    const r = await cleanIssues([
      { type: 'unused_skill', tier: 3, name: 'group/a', tokens: 1, path: join(tmp.skillsDir, 'group', 'a') },
    ]);
    expect(r.moved).toEqual([]);
    expect(r.errors[0]?.error).toMatch(/outside/i);
    expect(await exists(join(ext, 'group', 'a', 'SKILL.md'))).toBe(true);
  });

  it('does not delete a temp cache through a symlinked parent', async () => {
    await mkdir(join(ext, 'mkt', 'temp_git_1'), { recursive: true });
    await writeFile(join(ext, 'mkt', 'temp_git_1', 'f'), 'x');
    await symlink(join(ext, 'mkt'), join(tmp.pluginsDir, 'mkt'));
    const r = await cleanIssues([
      { type: 'temp_cache', tier: 1, name: 'temp_git_1', tokens: 0, path: join(tmp.pluginsDir, 'mkt', 'temp_git_1') },
    ]);
    expect(r.errors).toHaveLength(1);
    expect(await exists(join(ext, 'mkt', 'temp_git_1', 'f'))).toBe(true);
  });

  it('still moves a top-level symlinked skill — the link, not its target', async () => {
    await skillAt(join(ext, 'shared'));
    await symlink(join(ext, 'shared'), join(tmp.skillsDir, 'shared'));
    const r = await cleanIssues([
      { type: 'unused_skill', tier: 3, name: 'shared', tokens: 1, path: join(tmp.skillsDir, 'shared') },
    ]);
    expect(r.errors).toEqual([]);
    expect((await lstat(join(tmp.disabledDir, 'shared'))).isSymbolicLink()).toBe(true);
    expect(await exists(join(ext, 'shared', 'SKILL.md'))).toBe(true);
  });

  it('works for a profile whose managed dirs are themselves symlinks into another profile', async () => {
    // ~/.claude-acc3/{skills,skills.disabled} -> ~/.claude/{skills,skills.disabled}
    const profile = join(tmp.home, '.claude-acc3');
    await mkdir(profile, { recursive: true });
    await mkdir(tmp.disabledDir, { recursive: true });
    await symlink(tmp.skillsDir, join(profile, 'skills'));
    await symlink(tmp.disabledDir, join(profile, 'skills.disabled'));
    await symlink(tmp.projectsDir, join(profile, 'projects'));
    await symlink(join(tmp.claudeDir, 'plugins'), join(profile, 'plugins'));
    vi.stubEnv('CLAUDE_CONFIG_DIR', profile);

    await skillAt(join(tmp.skillsDir, 'foo'));
    const path = join(profile, 'skills', 'foo');
    const r = await cleanIssues([{ type: 'unused_skill', tier: 3, name: 'foo', tokens: 1, path }]);
    expect(r.errors).toEqual([]);
    expect(await exists(join(tmp.disabledDir, 'foo', 'SKILL.md'))).toBe(true);

    const [entry] = (await readManifest()) as ManifestEntry[];
    await restoreItem(entry);
    expect(await exists(join(tmp.skillsDir, 'foo', 'SKILL.md'))).toBe(true);
  });
});

describe('restore refuses to write through a symlinked parent', () => {
  it('leaves the backup parked when the original parent now points outside', async () => {
    await skillAt(join(tmp.skillsDir, 'group', 'a'));
    const r = await cleanIssues([
      { type: 'unused_skill', tier: 3, name: 'group/a', tokens: 1, path: join(tmp.skillsDir, 'group', 'a') },
    ]);
    expect(r.errors).toEqual([]);
    // cleanEmptyDirs removed skills/group; an attacker (or a stray link) puts it back as a symlink.
    await mkdir(join(ext, 'group'), { recursive: true });
    await symlink(join(ext, 'group'), join(tmp.skillsDir, 'group'));
    const [entry] = (await readManifest()) as ManifestEntry[];
    await expect(restoreItem(entry)).rejects.toThrow(/outside/i);
    expect(await exists(join(ext, 'group', 'a'))).toBe(false);
    expect(await exists(join(tmp.disabledDir, 'group--a', 'SKILL.md'))).toBe(true);
  });
});
