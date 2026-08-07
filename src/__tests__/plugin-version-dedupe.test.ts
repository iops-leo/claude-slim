import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { scanPluginSkills } from '../scanner/plugin-skills.js';
import { scanPluginSurfaces } from '../scanner/plugin-surfaces.js';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';

/**
 * Regression guard for an inflated headline number.
 *
 * A plugin's cache can hold more than one version directory, and `claude plugin
 * update` leaves the old one behind as a symlink to the new one:
 *
 *   ~/.claude/plugins/cache/omc/oh-my-claudecode/4.15.4/
 *   ~/.claude/plugins/cache/omc/oh-my-claudecode/4.9.1 -> 4.15.4
 *
 * `isDirectory()` stats rather than lstats, so the alias looked like a second
 * install and every skill under it was counted again. Only one version is ever
 * loaded into a session, so this inflated `totalTokensBefore` — the tool's
 * primary metric — by 931 tokens, 6.9%, on the machine where it was measured:
 * 41 of 148 plugin skill entries were a second copy of one plugin.
 *
 * Counting distinct skills is not the same as counting duplicates: two separate
 * plugins may legitimately ship the same skill names (`document-skills` and
 * `example-skills` share all 16), which is why the tests below pin same-name
 * skills from different plugins as something that must survive.
 */

let tmp: TmpClaude;

beforeAll(async () => { await initTokenizer(); });
afterEach(async () => { if (tmp) await tmp.cleanup(); });

async function writePluginSkill(
  versionDir: string,
  skillName: string,
  description: string,
): Promise<void> {
  const dir = join(versionDir, 'skills', skillName);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: ${description}\n---\n\n# ${skillName}\n\nbody\n`,
  );
}

describe('plugin cache holding several versions', () => {
  it('counts a skill once when an old version is a symlink to the new one', async () => {
    tmp = await createTmpClaude();
    const base = join(tmp.pluginsDir, 'omc', 'oh-my-claudecode');
    const current = join(base, '4.15.4');
    await writePluginSkill(current, 'autopilot', 'Full autonomous execution');
    await writePluginSkill(current, 'ralph', 'Self-referential loop');
    // What `claude plugin update` leaves behind.
    await symlink(current, join(base, '4.9.1'));

    const { skills } = await scanPluginSkills();
    expect(skills.map((s) => s.name).sort()).toEqual(['autopilot', 'ralph']);
  });

  it('counts a skill once when two real version directories exist', async () => {
    tmp = await createTmpClaude();
    const base = join(tmp.pluginsDir, 'omc', 'oh-my-claudecode');
    await writePluginSkill(join(base, '4.9.1'), 'autopilot', 'old copy');
    await writePluginSkill(join(base, '4.15.4'), 'autopilot', 'new copy');

    const { skills } = await scanPluginSkills();
    // Only one version is loaded at a time.
    expect(skills.filter((s) => s.name === 'autopilot')).toHaveLength(1);
  });

  it('does not collapse same-named skills from different plugins', async () => {
    tmp = await createTmpClaude();
    await writePluginSkill(join(tmp.pluginsDir, 'omc', 'plugin-a', '1.0.0'), 'review', 'a');
    await writePluginSkill(join(tmp.pluginsDir, 'other', 'plugin-b', '1.0.0'), 'review', 'b');

    const { skills } = await scanPluginSkills();
    expect(skills.filter((s) => s.name === 'review')).toHaveLength(2);
  });

  it('keeps a single-version plugin intact', async () => {
    tmp = await createTmpClaude();
    await writePluginSkill(join(tmp.pluginsDir, 'mkt', 'solo', '1.0.0'), 'only', 'one');

    const { skills } = await scanPluginSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('only');
  });
});

describe('scanPluginSurfaces with several cached versions', () => {
  it('reports one surface per plugin', async () => {
    tmp = await createTmpClaude();
    const base = join(tmp.pluginsDir, 'omc', 'oh-my-claudecode');
    const current = join(base, '4.15.4');
    await writePluginSkill(current, 'autopilot', 'Full autonomous execution');
    await symlink(current, join(base, '4.9.1'));

    const surfaces = await scanPluginSurfaces();
    // Two surfaces made every downstream per-plugin cost double, since the
    // cost map sums across surfaces while the breakdown picks just one.
    expect(surfaces.filter((s) => s.pluginName === 'oh-my-claudecode')).toHaveLength(1);
  });

  it('still lists distinct plugins separately', async () => {
    tmp = await createTmpClaude();
    await writePluginSkill(join(tmp.pluginsDir, 'omc', 'plugin-a', '1.0.0'), 's', 'a');
    await writePluginSkill(join(tmp.pluginsDir, 'omc', 'plugin-b', '1.0.0'), 's', 'b');

    const surfaces = await scanPluginSurfaces();
    expect(surfaces.map((s) => s.pluginName).sort()).toEqual(['plugin-a', 'plugin-b']);
  });
});
