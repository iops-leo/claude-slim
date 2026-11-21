import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { scan } from '../scanner/index.js';
import { parseUsageRecord } from '../scanner/usage-record.js';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, writeSkill, type TmpClaude } from './helpers/tmp-claude.js';

/**
 * Claude Code keeps its own per-skill usage record in `.claude.json`
 * (`skillUsage`, `pluginUsage`). It survives the session-log cleanup that caps
 * how far back the transcripts reach, so a skill used there inside the
 * lookback is in use even when no surviving log shows it.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 21);

describe('parseUsageRecord', () => {
  it('keeps skills last used inside the window, drops older ones', () => {
    const r = parseUsageRecord({
      skillUsage: {
        daily: { usageCount: 3, lastUsedAt: NOW - 10 * DAY },
        'myplug:s-myplug': { usageCount: 1, lastUsedAt: NOW - 59 * DAY },
        ancient: { usageCount: 9, lastUsedAt: NOW - 90 * DAY },
        junk: 'not an object',
      },
    }, NOW - 60 * DAY);
    expect([...r.skills].sort()).toEqual(['daily', 'myplug:s-myplug']);
  });

  it('counts a plugin used only when it has a use and that use is recent', () => {
    // A zero count with a recent timestamp is the entry being created, not a use.
    const r = parseUsageRecord({
      pluginUsage: {
        'used@mkt': { usageCount: 5, lastUsedAt: NOW - DAY },
        'never@mkt': { usageCount: 0, lastUsedAt: NOW - DAY },
        'old@mkt': { usageCount: 5, lastUsedAt: NOW - 100 * DAY },
      },
    }, NOW - 60 * DAY);
    expect([...r.plugins]).toEqual(['used@mkt']);
  });

  it('tolerates a missing or malformed record', () => {
    for (const j of [null, {}, { skillUsage: [] }, { pluginUsage: 7 }]) {
      const r = parseUsageRecord(j, 0);
      expect(r.skills.size + r.plugins.size).toBe(0);
    }
  });
});

describe('scan — skillUsage is a usage signal', () => {
  let tmp: TmpClaude;
  beforeAll(async () => { await initTokenizer(); });
  beforeEach(async () => { tmp = await createTmpClaude(); });
  afterEach(async () => { await tmp.cleanup(); });

  it('does not flag a skill .claude.json records as recently used', async () => {
    for (const name of ['daily', 'other', 'stale']) {
      await writeSkill(tmp.skillsDir, name, `---\nname: ${name}\ndescription: d\n---\nbody\n`);
    }
    const proj = join(tmp.projectsDir, '-tmp-proj');
    await mkdir(proj, { recursive: true });
    const line = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'other' } }] },
    });
    for (let i = 0; i < 3; i++) await writeFile(join(proj, `s${i}.jsonl`), line + '\n');
    const claudeJson = join(tmp.home, '.claude.json');
    const original = JSON.stringify({
      skillUsage: {
        daily: { usageCount: 2, lastUsedAt: Date.now() - 5 * DAY },
        stale: { usageCount: 2, lastUsedAt: Date.now() - 200 * DAY },
      },
    });
    await writeFile(claudeJson, original);

    const result = await scan({ lookbackDays: 60 });
    const unused = result.issues.filter((i) => i.type === 'unused_skill').map((i) => i.name);
    expect(unused).toEqual(['stale']);
    // Read-only: the record is never rewritten.
    expect(await readFile(claudeJson, 'utf-8')).toBe(original);
  });
});

describe('unused_plugin / PLUGIN BREAKDOWN — pluginUsage is a usage signal', () => {
  it('does not flag or mark unused a plugin pluginUsage saw used', async () => {
    const { detectors } = await import('../scanner/detectors.js');
    const { computePluginBreakdown } = await import('../scanner/plugin-breakdown.js');
    const surface = {
      pluginName: 'myplug', marketplace: 'mkt', version: '1', installDir: '/x', installedAt: 0,
      skills: ['s'], skillListingTokens: 0, mcpServerKeys: [], mcpToolPrefixes: [], commands: [],
      agentCount: 0, hookCount: 0,
    };
    const detector = detectors.find((d) => d.name === 'unused_plugin')!;
    const issues = detector.detect({
      pluginSurfaces: [surface], enabledPlugins: [{ name: 'myplug', marketplace: 'mkt' }],
      recentSkillInvocations: new Set(), recentMcpPrefixes: new Set(), recentCommands: new Set(),
      usedPlugins: new Set(['myplug@mkt']), totalUserCallableInvocations: 5, sessionsInWindow: 5,
      lookbackDays: 60, pluginCosts: new Map(),
    } as never);
    expect(issues).toEqual([]);
    const [row] = computePluginBreakdown({
      surfaces: [surface], installedPlugins: [{ name: 'myplug', marketplace: 'mkt', enabled: true }],
      invokedSkills: new Set(), usedPlugins: new Set(['myplug@mkt']), mcpPrefixesInvoked: new Set(),
      commandsInvoked: new Set(), totalUserCallableInvocations: 5, sessionsInWindow: 5, claudeMdSections: [],
    });
    expect(row.status).toBe('used');
  });
});
