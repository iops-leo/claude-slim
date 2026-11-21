import { describe, it, expect } from 'vitest';
import {
  listingBudgetChars,
  skillPriority,
  simulateListing,
  renderedDescription,
  MAX_DESC_CHARS,
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

describe('renderedDescription', () => {
  it('appends when_to_use after " - "', () => {
    expect(renderedDescription({ name: 'a', description: 'Does X.', whenToUse: 'When Y.' })).toBe(
      'Does X. - When Y.',
    );
  });

  it('truncates past the per-skill cap with an ellipsis', () => {
    const out = renderedDescription({ name: 'a', description: 'x'.repeat(MAX_DESC_CHARS + 50) });
    expect(out.length).toBe(MAX_DESC_CHARS);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('simulateListing', () => {
  const skill = (name: string, descLen: number) => ({ name, description: 'd'.repeat(descLen) });

  it('keeps every description when the listing fits', () => {
    const r = simulateListing([skill('a', 10), skill('b', 10)], {
      budgetChars: 1_000,
      priority: () => 0,
    });
    expect(r.mode).toBe('fits');
    expect(r.collapsed).toEqual([]);
    // "- a: dddddddddd" is 15 chars, two lines plus one newline.
    expect(r.fullChars).toBe(31);
    expect(r.renderedChars).toBe(31);
  });

  it('collapses the lowest-priority skills to their names when over budget', () => {
    const skills = [skill('hot', 40), skill('cold', 40), skill('warm', 40)];
    const pri: Record<string, number> = { hot: 10, warm: 5, cold: 0 };
    // name-only floor: "- hot"(5)+"- cold"(6)+"- warm"(6)+2 newlines = 19.
    // Each description adds 42 (": " + 40). Budget 110 leaves 91 → two fit.
    const r = simulateListing(skills, { budgetChars: 110, priority: (n) => pri[n] });
    expect(r.mode).toBe('priority');
    expect(r.collapsed).toEqual(['cold']);
    expect(r.renderedChars).toBe(19 + 42 + 42);
  });

  it('keeps a lower-priority short description when a higher one does not fit (greedy)', () => {
    const skills = [skill('big', 200), skill('small', 5)];
    const r = simulateListing(skills, {
      budgetChars: 40,
      priority: (n) => (n === 'big' ? 10 : 1),
    });
    expect(r.collapsed).toEqual(['big']);
  });

  it('never collapses name-only or bundled skills and counts them in full', () => {
    const skills = [
      { name: 'manual', description: 'd'.repeat(100), nameOnly: true },
      { name: 'builtin', description: 'd'.repeat(30), bundled: true },
      skill('user', 30),
    ];
    const r = simulateListing(skills, { budgetChars: 60, priority: () => 0 });
    expect(r.collapsed).toEqual(['user']);
    expect(r.nameOnly).toEqual(['manual']);
  });

  it('reports how many descriptions come back when skills are removed', () => {
    const skills = [skill('a', 40), skill('b', 40), skill('c', 40)];
    const before = simulateListing(skills, { budgetChars: 70, priority: () => 0 });
    const after = simulateListing(
      skills.filter((s) => s.name !== 'a'),
      { budgetChars: 70, priority: () => 0 },
    );
    expect(before.collapsed.length).toBe(2);
    expect(after.collapsed.length).toBe(1);
  });
});
