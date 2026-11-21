// How Claude Code budgets the skill listing in the system prompt.
//
// Read from Claude Code 2.1.323. The listing is not "every skill's description,
// summed": it has a budget, and once the full listing exceeds it Claude Code
// keeps descriptions in priority order and renders the rest as a bare
// `- name`. Those skills stay invocable, but the model sees only the name.
//
//   budget   = contextWindowTokens × charsPerToken × skillListingBudgetFraction
//              (SLASH_COMMAND_TOOL_CHAR_BUDGET replaces the whole formula),
//              spent in display width — wide characters count twice
//   entry    = `- name: description[ - when_to_use]`, description capped at
//              skillListingMaxDescChars (1536)
//   priority = skillUsage.usageCount × max(0.5^(daysSinceUse / 7), 0.1)
//
// Built-in skills and skills set to `name-only` in skillOverrides are never
// collapsed. Everything else is collapsed first, then descriptions are added
// back greedily in priority order while they fit.

export const DEFAULT_BUDGET_FRACTION = 0.01;
export const DEFAULT_CONTEXT_WINDOW = 200_000;
const HALF_LIFE_DAYS = 7;
const PRIORITY_FLOOR = 0.1;
const DAY_MS = 86_400_000;

export interface BudgetInputs {
  contextWindowTokens?: number;
  /** 3 for current models, 4 for claude-3.x and the 4.0–4.6 family. */
  bytesPerToken: number;
  /** `skillListingBudgetFraction` from settings. */
  fraction?: number;
  /** Raw `SLASH_COMMAND_TOOL_CHAR_BUDGET` value. */
  envOverride?: string;
}

export function listingBudgetChars(inputs: BudgetInputs): number {
  const override = Number.parseInt(inputs.envOverride ?? '', 10);
  if (Number.isFinite(override) && override > 0) return override;
  const window = inputs.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW;
  const fraction = inputs.fraction ?? DEFAULT_BUDGET_FRACTION;
  return Math.max(1, Math.floor(window * inputs.bytesPerToken * fraction));
}

export interface SkillUsageRecord {
  usageCount: number;
  lastUsedAt: number;
}

export function skillPriority(usage: SkillUsageRecord | undefined, now: number): number {
  if (!usage) return 0;
  const days = (now - usage.lastUsedAt) / DAY_MS;
  return usage.usageCount * Math.max(Math.pow(0.5, days / HALF_LIFE_DAYS), PRIORITY_FLOOR);
}

// Code points that take two terminal columns: Hangul, CJK, kana, fullwidth
// forms and emoji. Claude Code spends the listing budget in display width, not
// string length — a listing heavy in Korean is ~5% wider than its `.length`.
// Checked against live logs: listings of 28.4k–28.8k chars measured
// 29,957–29,983 wide under a 30,000 budget.
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec],
  [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615],
  [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce],
  [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755],
  [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x303e],
  [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f251],
  [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f9ff],
  [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
];
const ZERO_WIDTH = /[̀-ͯ​-‏⁠-⁤︀-️⃐-⃿]/u;

function isWide(cp: number): boolean {
  let lo = 0;
  let hi = WIDE_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = WIDE_RANGES[mid];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Terminal display width: wide characters count 2, combining marks 0. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    if (ZERO_WIDTH.test(ch)) continue;
    width += isWide(ch.codePointAt(0)!) ? 2 : 1;
  }
  return width;
}
