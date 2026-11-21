import { describe, it, expect } from 'vitest';
import {
  bytesPerTokenForModel,
  inferBudgetChars,
  analyzeListingVisibility,
  cappedListingTokens,
  cappedRecovery,
  type VisibilityContext,
} from '../scanner/listing-visibility.js';
import type { MeasuredStartup } from '../scanner/measured-startup.js';
import type { Issue, SkillInfo } from '../types.js';

const NOW = Date.parse('2026-11-21T00:00:00Z');

const skill = (name: string, source: SkillInfo['source'], listingTokens = 20, plugin?: string): SkillInfo => ({
  name,
  path: `/x/${name}`,
  sizeBytes: 100,
  tokens: 100,
  listingTokens,
  source,
  ...(plugin ? { plugin, pluginName: plugin } : {}),
});

const unused = (name: string): Issue =>
  ({ type: 'unused_skill', tier: 3, name, detail: '', tokens: 1, path: `/x/${name}` }) as Issue;

type E = { name: string; width: number; collapsed: boolean };

function measured(entries: E[], model = 'claude-opus-5-5'): MeasuredStartup {
  const width = entries.reduce((s, e) => s + e.width, 0) + entries.length - 1;
  return {
    sessionFile: '/p/s.jsonl',
    fromOtherProject: false,
    model,
    version: '2.1.323',
    entrypoint: 'cli',
    timestamp: '2026-11-20T10:00:00.000Z',
    skillListing: {
      chars: width,
      width,
      tokens: Math.round(width / 3),
      skillCount: entries.length,
      entries: entries.map((e) => ({ ...e, chars: e.width })),
    },
  };
}

function ctx(over: Partial<VisibilityContext>): VisibilityContext {
  return {
    localSkills: [],
    pluginSkills: [],
    syncedSkills: [],
    issues: [],
    skillUsage: {},
    settings: {},
    now: NOW,
    ...over,
  };
}

describe('bytesPerTokenForModel', () => {
  it('uses 4 for claude-3 and the 4.0–4.6 family, 3 otherwise', () => {
    expect(bytesPerTokenForModel('claude-sonnet-4-5-20250929')).toBe(4);
    expect(bytesPerTokenForModel('claude-3-7-sonnet-latest')).toBe(4);
    expect(bytesPerTokenForModel('claude-opus-4-6')).toBe(4);
    expect(bytesPerTokenForModel('claude-opus-5-5')).toBe(3);
    expect(bytesPerTokenForModel('claude-opus-4-8')).toBe(3);
    expect(bytesPerTokenForModel(undefined)).toBe(3);
  });
});

describe('inferBudgetChars', () => {
  it('picks the smallest standard window that holds the rendered width', () => {
    const m = measured([{ name: 'a', width: 29_950, collapsed: false }, { name: 'b', width: 3, collapsed: true }]);
    expect(inferBudgetChars(m, {})).toEqual({ chars: 30_000, basis: 'inferred' });
  });

  it('measures in display width, not string length', () => {
    // 5,900 chars of Korean-heavy text can be 6,200 wide: only the 1M budget holds it.
    const m = measured([{ name: 'a', width: 6_200, collapsed: false }]);
    m.skillListing!.chars = 5_900;
    expect(inferBudgetChars(m, {}).chars).toBe(30_000);
  });

  it('honours SLASH_COMMAND_TOOL_CHAR_BUDGET', () => {
    const m = measured([{ name: 'a', width: 100, collapsed: false }]);
    expect(inferBudgetChars(m, { env: '15000' })).toEqual({ chars: 15_000, basis: 'env' });
  });

  it('scales with skillListingBudgetFraction', () => {
    const m = measured([{ name: 'a', width: 11_000, collapsed: false }, { name: 'b', width: 3, collapsed: true }]);
    expect(inferBudgetChars(m, { fraction: 0.02 })).toEqual({ chars: 12_000, basis: 'inferred' });
  });
});

describe('analyzeListingVisibility', () => {
  it('returns null without a measured listing', () => {
    expect(analyzeListingVisibility(null, ctx({}))).toBeNull();
  });

  it('lists collapsed skills with where they come from and whether they are flagged unused', () => {
    const m = measured([
      { name: 'used', width: 40, collapsed: false },
      { name: 'idle', width: 6, collapsed: true },
      { name: 'omc:ralph', width: 11, collapsed: true },
      { name: 'anthropic-skills:pdf', width: 22, collapsed: true },
      { name: 'mcp-thing', width: 11, collapsed: true },
    ]);
    const v = analyzeListingVisibility(m, ctx({
      localSkills: [skill('used', 'local'), skill('idle', 'local')],
      pluginSkills: [skill('ralph', 'plugin', 20, 'omc')],
      syncedSkills: [skill('anthropic-skills:pdf', 'synced')],
      issues: [unused('idle')],
    }))!;
    expect(v.collapsed).toEqual([
      { name: 'idle', source: 'local', flaggedUnused: true },
      { name: 'omc:ralph', source: 'plugin', plugin: 'omc', flaggedUnused: false },
      { name: 'anthropic-skills:pdf', source: 'synced', flaggedUnused: false },
      { name: 'mcp-thing', source: 'unknown', flaggedUnused: false },
    ]);
    expect(v.overBudget).toBeDefined();
  });

  it('does not count skills the user set to name-only as cut by the budget', () => {
    const m = measured([
      { name: 'a', width: 40, collapsed: false },
      { name: 'manual', width: 8, collapsed: true },
    ]);
    const v = analyzeListingVisibility(m, ctx({
      settings: { skillOverrides: { manual: 'name-only' } },
    }))!;
    expect(v.collapsed).toEqual([]);
    expect(v.nameOnlyByChoice).toBe(1);
    expect(v.overBudget).toBeUndefined();
  });

  it('applies no cap when nothing was collapsed — the budget is only a lower bound then', () => {
    const m = measured([{ name: 'a', width: 5_000, collapsed: false }]);
    expect(analyzeListingVisibility(m, ctx({}))!.overBudget).toBeUndefined();
  });

  it('prices an overflowing listing at its budget plus the hidden descriptions', () => {
    const m = measured([
      { name: 'f', width: 5_990, collapsed: false },
      { name: 'c1', width: 4, collapsed: true },
    ]);
    const v = analyzeListingVisibility(m, ctx({ localSkills: [skill('c1', 'local', 100)] }))!;
    // tokens/width = 1/3; budget 6,000 → cap 2,000; c1 hides 100 − 6/3 = 98.
    expect(v.overBudget).toEqual({ capTokens: 2_000, fullTokens: 2_098 });
  });

  it('estimates the descriptions cleaning the flagged skills would bring back, from the measured state', () => {
    const m = measured([
      { name: 'big', width: 1_500, collapsed: false },
      { name: 'f1', width: 1_500, collapsed: false },
      { name: 'f2', width: 1_500, collapsed: false },
      { name: 'f3', width: 1_400, collapsed: false },
      { name: 'c1', width: 4, collapsed: true },
      { name: 'c2', width: 4, collapsed: true },
    ]);
    const disk = [skill('big', 'local', 500), skill('c1', 'local', 100), skill('c2', 'local', 100)];
    const withFlag = analyzeListingVisibility(m, ctx({ localSkills: disk, issues: [unused('big')] }))!;
    // Room: 87 of slack + big's 1,501 → both ~296-wide descriptions fit.
    expect(withFlag.restoredIfFlaggedCleaned).toBe(2);
    const noFlag = analyzeListingVisibility(m, ctx({ localSkills: disk }))!;
    expect(noFlag.restoredIfFlaggedCleaned).toBe(0);
  });

  it('restores in priority order when room is short', () => {
    const m = measured([
      { name: 'big', width: 400, collapsed: false },
      { name: 'f', width: 5_580, collapsed: false },
      { name: 'cold', width: 6, collapsed: true },
      { name: 'warm', width: 6, collapsed: true },
    ]);
    const v = analyzeListingVisibility(m, ctx({
      localSkills: [skill('big', 'local'), skill('cold', 'local', 100), skill('warm', 'local', 100)],
      issues: [unused('big')],
      skillUsage: { warm: { usageCount: 3, lastUsedAt: NOW } },
    }))!;
    // Room ≈ 401 + slack: one ~296-wide description fits.
    expect(v.restoredIfFlaggedCleaned).toBe(1);
  });
});

describe('cappedListingTokens / cappedRecovery', () => {
  it('caps the listing at the budget', () => {
    expect(cappedListingTokens(12_000, 10_000)).toBe(10_000);
    expect(cappedListingTokens(8_000, 10_000)).toBe(8_000);
    expect(cappedListingTokens(8_000, undefined)).toBe(8_000);
  });

  it('recovers nothing from removing skills while the listing stays over budget', () => {
    expect(cappedRecovery(12_000, 1_000, 10_000)).toBe(0);
    expect(cappedRecovery(12_000, 3_000, 10_000)).toBe(1_000);
    expect(cappedRecovery(8_000, 1_000, 10_000)).toBe(1_000);
    expect(cappedRecovery(8_000, 1_000, undefined)).toBe(1_000);
  });
});
