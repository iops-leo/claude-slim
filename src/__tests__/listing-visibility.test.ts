import { describe, it, expect } from 'vitest';
import {
  bytesPerTokenForModel,
  inferBudgetChars,
  analyzeListingVisibility,
  cappedListingTokens,
  cappedRecovery,
} from '../scanner/listing-visibility.js';
import type { MeasuredStartup } from '../scanner/measured-startup.js';
import type { Issue, SkillInfo } from '../types.js';

const skill = (name: string, source: SkillInfo['source'], listingTokens = 20, plugin?: string): SkillInfo => ({
  name,
  path: `/x/${name}`,
  sizeBytes: 100,
  tokens: 100,
  listingTokens,
  source,
  ...(plugin ? { plugin, pluginName: plugin } : {}),
});

function measured(entries: Array<{ name: string; chars: number; collapsed: boolean }>, model = 'claude-opus-5-5'): MeasuredStartup {
  const chars = entries.reduce((s, e) => s + e.chars, 0) + entries.length - 1;
  return {
    sessionFile: '/p/s.jsonl',
    fromOtherProject: false,
    model,
    version: '2.1.323',
    timestamp: '2026-11-20T10:00:00.000Z',
    skillListing: { chars, tokens: Math.round(chars / 3), skillCount: entries.length, entries },
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
  it('picks the smallest standard window that holds an over-budget listing', () => {
    // 28,792 rendered chars with collapsed entries: 200k × 3 × 1% = 6,000 cannot
    // hold it, 1M × 3 × 1% = 30,000 can.
    const m = measured([{ name: 'a', chars: 28_792, collapsed: false }, { name: 'b', chars: 3, collapsed: true }]);
    expect(inferBudgetChars(m, {})).toEqual({ chars: 30_000, basis: 'inferred' });
  });

  it('honours SLASH_COMMAND_TOOL_CHAR_BUDGET', () => {
    const m = measured([{ name: 'a', chars: 100, collapsed: false }]);
    expect(inferBudgetChars(m, { env: '4000' })).toEqual({ chars: 4_000, basis: 'env' });
  });

  it('scales with skillListingBudgetFraction', () => {
    const m = measured([{ name: 'a', chars: 11_000, collapsed: false }, { name: 'b', chars: 3, collapsed: true }]);
    expect(inferBudgetChars(m, { fraction: 0.02 })).toEqual({ chars: 12_000, basis: 'inferred' });
  });
});

describe('analyzeListingVisibility', () => {
  it('lists collapsed skills with where they come from and whether they are flagged unused', () => {
    const m = measured([
      { name: 'used', chars: 40, collapsed: false },
      { name: 'idle', chars: 6, collapsed: true },
      { name: 'omc:ralph', chars: 11, collapsed: true },
      { name: 'anthropic-skills:pdf', chars: 22, collapsed: true },
      { name: 'code-review', chars: 50, collapsed: false },
    ]);
    const issues: Issue[] = [
      { type: 'unused_skill', tier: 3, name: 'idle', detail: '', tokens: 10, path: '/x/idle' } as Issue,
    ];
    const v = analyzeListingVisibility(m, {
      localSkills: [skill('used', 'local'), skill('idle', 'local')],
      pluginSkills: [skill('ralph', 'plugin', 20, 'omc')],
      syncedSkills: [skill('anthropic-skills:pdf', 'synced')],
      issues,
      skillUsage: {},
      settings: {},
      now: Date.parse('2026-11-21T00:00:00Z'),
    })!;
    expect(v.skillCount).toBe(5);
    expect(v.collapsed).toEqual([
      { name: 'idle', source: 'local', flaggedUnused: true },
      { name: 'omc:ralph', source: 'plugin', plugin: 'omc', flaggedUnused: false },
      { name: 'anthropic-skills:pdf', source: 'synced', flaggedUnused: false },
    ]);
  });

  it('returns null without a measured listing', () => {
    expect(
      analyzeListingVisibility(null, {
        localSkills: [], pluginSkills: [], syncedSkills: [], issues: [], skillUsage: {}, settings: {}, now: 0,
      }),
    ).toBeNull();
  });

  it('estimates how many descriptions come back if the flagged skills are cleaned', () => {
    // Rendered 5,913 chars with 'c1','c2' collapsed → 200k window, 6,000 budget.
    // Cleaning 'big' (flagged unused) frees room for both descriptions.
    const m = measured([
      { name: 'big', chars: 1_500, collapsed: false },
      { name: 'filler1', chars: 1_500, collapsed: false },
      { name: 'filler2', chars: 1_500, collapsed: false },
      { name: 'filler3', chars: 1_400, collapsed: false },
      { name: 'c1', chars: 4, collapsed: true },
      { name: 'c2', chars: 4, collapsed: true },
    ]);
    const filler = { usageCount: 50, lastUsedAt: Date.parse('2026-11-20T00:00:00Z') };
    const v = analyzeListingVisibility(m, {
      localSkills: [
        skill('big', 'local', 500),
        skill('filler1', 'local', 500),
        skill('filler2', 'local', 500),
        skill('filler3', 'local', 470),
        skill('c1', 'local', 100),
        skill('c2', 'local', 100),
      ],
      pluginSkills: [],
      syncedSkills: [],
      issues: [{ type: 'unused_skill', tier: 3, name: 'big', detail: '', tokens: 1, path: '/x/big' } as Issue],
      // Priorities that reproduce the measured listing: filler and big kept, c1/c2 not.
      skillUsage: {
        filler1: filler,
        filler2: filler,
        filler3: filler,
        big: { usageCount: 20, lastUsedAt: Date.parse('2026-11-20T00:00:00Z') },
        c1: { usageCount: 1, lastUsedAt: Date.parse('2026-11-20T00:00:00Z') },
      },
      settings: {},
      now: Date.parse('2026-11-21T00:00:00Z'),
    })!;
    expect(v.restoredIfFlaggedCleaned).toBe(2);
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
