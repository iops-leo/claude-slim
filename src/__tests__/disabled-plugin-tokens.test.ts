import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { scanPluginSkills } from '../scanner/plugin-skills.js';
import { scan } from '../scanner/index.js';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';
import * as fsWalk from '../scanner/fs-walk.js';

/**
 * A disabled plugin's skills are not in the session catalog, so they are not a
 * startup cost. Counting them put 3,397 tokens — 27% of the total — into a
 * number labelled "tokens at session start". Confirmed against a live session:
 * every disabled plugin's skills were absent from the prompt while enabled
 * ones were present.
 *
 * The dangerous direction is over-exclusion. `claude plugin list` reports a
 * third state, `failed to load`, which is neither enabled nor disabled —
 * `railway` reports it after a hook clash and its twelve skills still load. So
 * only names explicitly reported disabled are dropped; anything unrecognised
 * keeps counting.
 */

let tmp: TmpClaude;

beforeAll(async () => { await initTokenizer(); });
afterEach(async () => { if (tmp) await tmp.cleanup(); vi.restoreAllMocks(); });

async function writePluginSkill(marketplace: string, plugin: string, skill: string): Promise<void> {
  const dir = join(tmp.pluginsDir, marketplace, plugin, '1.0.0', 'skills', skill);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${skill}\ndescription: Does ${skill} things for the user\n---\n\nbody\n`,
  );
}

/** Stub `claude plugin list` with the real output shape. */
function stubPluginList(rows: Array<{ plugin: string; marketplace: string; status: string }>): void {
  const output = ['Installed plugins:', ''].concat(
    rows.flatMap((r) => [
      `  ❯ ${r.plugin}@${r.marketplace}`,
      `    Version: 1.0.0`,
      `    Scope: user`,
      `    Status: ${r.status}`,
      '',
    ]),
  ).join('\n');
  vi.spyOn(fsWalk, 'runCommand').mockResolvedValue(output);
}


describe('scanPluginSkills attribution', () => {
  it('records the plugin, not just the marketplace directory', async () => {
    tmp = await createTmpClaude();
    await writePluginSkill('omc', 'oh-my-claudecode', 'autopilot');

    const { skills } = await scanPluginSkills();
    expect(skills).toHaveLength(1);
    // The distinction the exclusion depends on: enabled state is per plugin,
    // and one marketplace can host several.
    expect(skills[0].pluginName).toBe('omc');
    expect(skills[0].plugin).toBe('oh-my-claudecode');
  });

  it('separates two plugins sharing one marketplace', async () => {
    tmp = await createTmpClaude();
    await writePluginSkill('official', 'plugin-a', 'sa');
    await writePluginSkill('official', 'plugin-b', 'sb');

    const { skills } = await scanPluginSkills();
    expect(skills.map((s) => s.plugin).sort()).toEqual(['plugin-a', 'plugin-b']);
  });
});

describe('startup total excludes disabled plugins', () => {
  it('drops a disabled plugin and keeps an enabled one', async () => {
    tmp = await createTmpClaude();
    await writePluginSkill('mkt', 'live', 'kept');
    await writePluginSkill('mkt', 'dormant', 'dropped');
    stubPluginList([
      { plugin: 'live', marketplace: 'mkt', status: '✔ enabled' },
      { plugin: 'dormant', marketplace: 'mkt', status: '✘ disabled' },
    ]);

    const result = await scan();
    const kept = result.pluginSkills.find((s) => s.name === 'kept')!;
    const dropped = result.pluginSkills.find((s) => s.name === 'dropped')!;

    expect(result.disabledPluginSkillTokens).toBe(dropped.listingTokens);
    // Both are still listed; only the total changes.
    expect(result.pluginSkills).toHaveLength(2);
    expect(result.totalTokensBefore).toBeGreaterThanOrEqual(kept.listingTokens);
    expect(result.totalTokensBefore).toBeLessThan(kept.listingTokens + dropped.listingTokens + 1);
  });

  it('keeps a plugin whose status is neither enabled nor disabled', async () => {
    tmp = await createTmpClaude();
    await writePluginSkill('railway-claude-plugin', 'railway', 'deploy');
    stubPluginList([
      {
        plugin: 'railway',
        marketplace: 'railway-claude-plugin',
        status: '✘ failed to load',
      },
    ]);

    const result = await scan();
    // Its skills do load despite the hook failure, so they stay in the total.
    expect(result.disabledPluginSkillTokens).toBe(0);
    expect(result.totalTokensBefore).toBeGreaterThan(0);
  });

  it('keeps a plugin absent from the list entirely', async () => {
    tmp = await createTmpClaude();
    await writePluginSkill('mkt', 'unlisted', 'skill');
    stubPluginList([]);

    const result = await scan();
    expect(result.disabledPluginSkillTokens).toBe(0);
  });

  it('reports zero when nothing is disabled', async () => {
    tmp = await createTmpClaude();
    await writePluginSkill('mkt', 'live', 'skill');
    stubPluginList([{ plugin: 'live', marketplace: 'mkt', status: '✔ enabled' }]);

    const result = await scan();
    expect(result.disabledPluginSkillTokens).toBe(0);
  });

  it('never subtracts more than the plugin skills are worth', async () => {
    tmp = await createTmpClaude();
    await writePluginSkill('mkt', 'a', 's1');
    await writePluginSkill('mkt', 'b', 's2');
    stubPluginList([
      { plugin: 'a', marketplace: 'mkt', status: '✘ disabled' },
      { plugin: 'b', marketplace: 'mkt', status: '✘ disabled' },
    ]);

    const result = await scan();
    const allPluginListing = result.pluginSkills.reduce((n, s) => n + s.listingTokens, 0);
    expect(result.disabledPluginSkillTokens).toBe(allPluginListing);
    expect(result.totalTokensBefore).toBeGreaterThanOrEqual(0);
  });
});
