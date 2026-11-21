import { describe, it, expect } from 'vitest';
import {
  listingBudgetChars,
  skillPriority,
  displayWidth,
} from '../scanner/listing-budget.js';

const DAY = 86_400_000;

describe('listingBudgetChars', () => {
  it('is 1% of the context window at 3 chars/token for current models', () => {
    expect(listingBudgetChars({ contextWindowTokens: 200_000, bytesPerToken: 3 })).toBe(6_000);
    expect(listingBudgetChars({ contextWindowTokens: 1_000_000, bytesPerToken: 3 })).toBe(30_000);
  });

  it('uses 4 chars/token for older models', () => {
    expect(listingBudgetChars({ contextWindowTokens: 200_000, bytesPerToken: 4 })).toBe(8_000);
  });

  it('honours skillListingBudgetFraction', () => {
    expect(
      listingBudgetChars({ contextWindowTokens: 200_000, bytesPerToken: 3, fraction: 0.02 }),
    ).toBe(12_000);
  });

  it('lets SLASH_COMMAND_TOOL_CHAR_BUDGET override everything', () => {
    expect(
      listingBudgetChars({ contextWindowTokens: 200_000, bytesPerToken: 3, envOverride: '500' }),
    ).toBe(500);
  });

  it('ignores a non-numeric env override', () => {
    expect(
      listingBudgetChars({ contextWindowTokens: 200_000, bytesPerToken: 3, envOverride: 'abc' }),
    ).toBe(6_000);
  });
});

describe('skillPriority', () => {
  const now = 1_800_000_000_000;

  it('is 0 for a skill with no usage record', () => {
    expect(skillPriority(undefined, now)).toBe(0);
  });

  it('halves every 7 days', () => {
    expect(skillPriority({ usageCount: 8, lastUsedAt: now }, now)).toBeCloseTo(8);
    expect(skillPriority({ usageCount: 8, lastUsedAt: now - 7 * DAY }, now)).toBeCloseTo(4);
  });

  it('never decays below 10% of the use count', () => {
    expect(skillPriority({ usageCount: 10, lastUsedAt: now - 365 * DAY }, now)).toBeCloseTo(1);
  });
});

describe('displayWidth', () => {
  it('counts Hangul, CJK and emoji as two columns', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('한글')).toBe(4);
    expect(displayWidth('日本')).toBe(4);
    expect(displayWidth('🚀')).toBe(2);
    expect(displayWidth('é')).toBe(1);
  });
});
