// Model of how Claude Code fits the skill listing into the system prompt.
//
// Reverse-read from Claude Code 2.1.323. The listing is not "every skill's
// description, summed": it has a character budget, and once the full listing
// exceeds it Claude Code keeps descriptions in priority order and renders the
// rest as a bare `- name`. Those skills stay invocable, but the model only sees
// their name — it cannot tell from the listing what they are for.
//
//   budget   = contextWindowTokens × charsPerToken × skillListingBudgetFraction
//              (SLASH_COMMAND_TOOL_CHAR_BUDGET env replaces the whole formula)
//   entry    = `- name: description[ - when_to_use]`, description capped at 1536 chars
//   priority = skillUsage.usageCount × max(0.5^(daysSinceUse / 7), 0.1)
//
// Bundled (built-in) skills and skills set to `name-only` in skillOverrides are
// never collapsed. Everything else is collapsed to its name first, then
// descriptions are added back greedily in priority order while they fit.

export const DEFAULT_BUDGET_FRACTION = 0.01;
export const DEFAULT_CONTEXT_WINDOW = 200_000;
export const MAX_DESC_CHARS = 1536;
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

export interface ListingSkill {
  name: string;
  description: string;
  whenToUse?: string;
  /** `skillOverrides: { name: "name-only" }` — always rendered as `- name`. */
  nameOnly?: boolean;
  /** Built into Claude Code — always rendered in full. */
  bundled?: boolean;
}

export function renderedDescription(skill: ListingSkill): string {
  const text = skill.whenToUse ? `${skill.description} - ${skill.whenToUse}` : skill.description;
  return text.length > MAX_DESC_CHARS ? text.slice(0, MAX_DESC_CHARS - 1) + '…' : text;
}

export interface ListingSimulation {
  mode: 'fits' | 'priority';
  budgetChars: number;
  /** Size the listing would have with every description shown. */
  fullChars: number;
  /** Size of the listing Claude Code actually renders. */
  renderedChars: number;
  /** Skills shown as a bare name because the budget ran out, in input order. */
  collapsed: string[];
  /** Skills the user set to name-only. */
  nameOnly: string[];
}

export interface SimulateOptions {
  budgetChars: number;
  priority: (name: string) => number;
}

interface Entry {
  skill: ListingSkill;
  index: number;
  nameLine: number;
  fullLine: number;
  fixed: boolean;
}

export function simulateListing(
  skills: readonly ListingSkill[],
  opts: SimulateOptions,
): ListingSimulation {
  const entries: Entry[] = skills.map((skill, index) => {
    const nameLine = `- ${skill.name}`.length;
    const fullLine = skill.nameOnly ? nameLine : nameLine + 2 + renderedDescription(skill).length;
    return { skill, index, nameLine, fullLine, fixed: Boolean(skill.nameOnly || skill.bundled) };
  });
  const newlines = Math.max(0, entries.length - 1);
  const fullChars = entries.reduce((sum, e) => sum + e.fullLine, 0) + newlines;
  const nameOnly = skills.filter((s) => s.nameOnly).map((s) => s.name);
  const base = { budgetChars: opts.budgetChars, fullChars, nameOnly };

  if (fullChars <= opts.budgetChars) {
    return { ...base, mode: 'fits', renderedChars: fullChars, collapsed: [] };
  }

  const floor =
    entries.reduce((sum, e) => sum + (e.fixed ? e.fullLine : e.nameLine), 0) + newlines;
  let remaining = opts.budgetChars - floor;
  // Array.prototype.sort is stable, so equal priorities keep listing order —
  // the same tie-break Claude Code gets.
  const candidates = entries
    .filter((e) => !e.fixed)
    .sort((a, b) => opts.priority(b.skill.name) - opts.priority(a.skill.name));
  const kept = new Set<number>();
  for (const e of candidates) {
    const extra = e.fullLine - e.nameLine;
    if (extra <= remaining) {
      kept.add(e.index);
      remaining -= extra;
    }
  }
  const collapsedEntries = entries.filter((e) => !e.fixed && !kept.has(e.index));
  const renderedChars =
    entries.reduce(
      (sum, e) => sum + (e.fixed || kept.has(e.index) ? e.fullLine : e.nameLine),
      0,
    ) + newlines;
  return {
    ...base,
    mode: 'priority',
    renderedChars,
    collapsed: collapsedEntries.map((e) => e.skill.name),
  };
}
