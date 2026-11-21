// Joins the skill listing Claude Code actually rendered (measured-startup.ts)
// with what is installed on disk, so the report can say which skills the model
// sees by name only, where they come from, and what cleaning would change.
import type { Issue, SkillInfo } from '../types.js';
import type { MeasuredStartup } from './measured-startup.js';
import {
  DEFAULT_BUDGET_FRACTION,
  listingBudgetChars,
  simulateListing,
  skillPriority,
  type ListingSkill,
  type SkillUsageRecord,
} from './listing-budget.js';

/** Context windows Claude Code models ship with. */
const STANDARD_WINDOWS = [200_000, 1_000_000];

// Claude Code budgets 4 chars/token for these model families and 3 for
// everything newer (2.1.323). Matched on the normalized model id.
const FOUR_CHAR_MODELS = [
  /^claude-3(-|$)/,
  /^claude-(opus|sonnet)-4-[0156](-|$)/,
  /^claude-haiku-4-5(-|$)/,
  /^claude-(opus|sonnet)-4(-\d{8})?$/,
];

export function bytesPerTokenForModel(model: string | undefined): number {
  if (!model) return 3;
  const id = model.toLowerCase().replace(/[._]/g, '-');
  return FOUR_CHAR_MODELS.some((re) => re.test(id)) ? 4 : 3;
}

export interface BudgetSettings {
  /** `SLASH_COMMAND_TOOL_CHAR_BUDGET`. */
  env?: string;
  /** Effective `skillListingBudgetFraction`. */
  fraction?: number;
}

export interface InferredBudget {
  chars: number;
  basis: 'env' | 'inferred';
}

/**
 * The listing budget for the measured session. The context window is not in
 * the log, so pick the smallest standard window whose budget holds what was
 * rendered — a rendered listing never exceeds its budget.
 */
export function inferBudgetChars(m: MeasuredStartup, s: BudgetSettings): InferredBudget {
  const bytesPerToken = bytesPerTokenForModel(m.model);
  const fromEnv = listingBudgetChars({ bytesPerToken, envOverride: s.env, contextWindowTokens: 1 });
  const envValue = Number.parseInt(s.env ?? '', 10);
  if (Number.isFinite(envValue) && envValue > 0) return { chars: fromEnv, basis: 'env' };
  const rendered = m.skillListing?.chars ?? 0;
  const candidates = STANDARD_WINDOWS.map((w) =>
    listingBudgetChars({ contextWindowTokens: w, bytesPerToken, fraction: s.fraction ?? DEFAULT_BUDGET_FRACTION }),
  );
  const chars = candidates.find((c) => c >= rendered) ?? candidates[candidates.length - 1];
  return { chars, basis: 'inferred' };
}

export interface CollapsedSkill {
  name: string;
  source: SkillInfo['source'] | 'unknown';
  plugin?: string;
  /** claude-slim already flags it unused, so cleaning it also frees room. */
  flaggedUnused: boolean;
}

export interface ListingVisibility {
  sessionFile: string;
  sessionDate?: string;
  claudeCodeVersion?: string;
  fromOtherProject: boolean;
  skillCount: number;
  listingChars: number;
  listingTokens: number;
  budgetChars: number;
  budgetBasis: InferredBudget['basis'];
  /** Rendered listing expressed in tokens at the budget — the listing's ceiling. */
  budgetTokens: number;
  collapsed: CollapsedSkill[];
  /** Descriptions that would come back if every skill flagged unused were cleaned. */
  restoredIfFlaggedCleaned: number;
}

export interface VisibilityContext {
  localSkills: SkillInfo[];
  pluginSkills: SkillInfo[];
  syncedSkills: SkillInfo[];
  issues: Issue[];
  skillUsage: Record<string, SkillUsageRecord>;
  settings: BudgetSettings & { skillOverrides?: Record<string, unknown> };
  now: number;
}

interface DiskMatch {
  skill: SkillInfo;
  flaggedUnused: boolean;
}

function indexDisk(ctx: VisibilityContext): Map<string, DiskMatch> {
  const unusedSkills = new Set(
    ctx.issues.filter((i) => i.type === 'unused_skill').map((i) => i.path),
  );
  const unusedPlugins = new Set(
    ctx.issues.filter((i) => i.type === 'unused_plugin').map((i) => i.name),
  );
  const out = new Map<string, DiskMatch>();
  for (const s of ctx.localSkills) out.set(s.name, { skill: s, flaggedUnused: unusedSkills.has(s.path) });
  for (const s of ctx.syncedSkills) out.set(s.name, { skill: s, flaggedUnused: false });
  for (const s of ctx.pluginSkills) {
    const flaggedUnused =
      (s.plugin !== undefined && unusedPlugins.has(s.plugin)) ||
      (s.pluginName !== undefined && unusedPlugins.has(s.pluginName));
    for (const owner of [s.plugin, s.pluginName]) {
      if (owner && !out.has(`${owner}:${s.name}`)) out.set(`${owner}:${s.name}`, { skill: s, flaggedUnused });
    }
  }
  return out;
}

export function analyzeListingVisibility(
  m: MeasuredStartup | null,
  ctx: VisibilityContext,
): ListingVisibility | null {
  const listing = m?.skillListing;
  if (!m || !listing) return null;
  const budget = inferBudgetChars(m, ctx.settings);
  const tokensPerChar = listing.chars > 0 ? listing.tokens / listing.chars : 1 / 3;
  const disk = indexDisk(ctx);

  const collapsed: CollapsedSkill[] = listing.entries
    .filter((e) => e.collapsed)
    .map((e) => {
      const hit = disk.get(e.name);
      if (!hit) return { name: e.name, source: 'unknown' as const, flaggedUnused: false };
      const owner = hit.skill.source === 'plugin' ? hit.skill.plugin ?? hit.skill.pluginName : undefined;
      return {
        name: e.name,
        source: hit.skill.source,
        ...(owner ? { plugin: owner } : {}),
        flaggedUnused: hit.flaggedUnused,
      };
    });

  // Rebuild the listing for the simulator. Shown entries carry their exact
  // description length; collapsed ones get an estimate from the disk listing
  // cost. Unknown names that were shown are bundled or MCP skills — fixed.
  const overrides = ctx.settings.skillOverrides ?? {};
  const charsPerToken = 1 / tokensPerChar;
  const rebuilt: Array<ListingSkill & { flagged: boolean }> = listing.entries.map((e) => {
    const hit = disk.get(e.name);
    const nameLine = `- ${e.name}`.length;
    const descLen = e.collapsed
      ? Math.max(0, Math.round((hit?.skill.listingTokens ?? 30) * charsPerToken) - nameLine - 2)
      : Math.max(0, e.chars - nameLine - 2);
    return {
      name: e.name,
      description: 'x'.repeat(descLen),
      nameOnly: overrides[e.name] === 'name-only',
      bundled: !hit && !e.collapsed,
      flagged: hit?.flaggedUnused ?? false,
    };
  });
  const priority = (name: string): number => skillPriority(ctx.skillUsage[name], ctx.now);
  const before = simulateListing(rebuilt, { budgetChars: budget.chars, priority });
  const after = simulateListing(
    rebuilt.filter((s) => !s.flagged),
    { budgetChars: budget.chars, priority },
  );
  // Flagged skills that were collapsed leave with the cleanup; they are not "restored".
  const flaggedNames = new Set(rebuilt.filter((s) => s.flagged).map((s) => s.name));
  const keptCollapsedBefore = before.collapsed.filter((n) => !flaggedNames.has(n)).length;
  const restored = Math.max(0, keptCollapsedBefore - after.collapsed.length);

  return {
    sessionFile: m.sessionFile,
    ...(m.timestamp ? { sessionDate: m.timestamp.slice(0, 10) } : {}),
    ...(m.version ? { claudeCodeVersion: m.version } : {}),
    fromOtherProject: m.fromOtherProject,
    skillCount: listing.skillCount,
    listingChars: listing.chars,
    listingTokens: listing.tokens,
    budgetChars: budget.chars,
    budgetBasis: budget.basis,
    budgetTokens: Math.round(budget.chars * tokensPerChar),
    collapsed,
    restoredIfFlaggedCleaned: restored,
  };
}

/** The skill listing never costs more than its budget. */
export function cappedListingTokens(fullTokens: number, capTokens: number | undefined): number {
  return capTokens === undefined ? fullTokens : Math.min(fullTokens, capTokens);
}

/**
 * Startup tokens actually freed by removing `removedTokens` of listing from a
 * listing worth `fullTokens` uncapped. While the listing stays over budget,
 * removal only lets other descriptions back in — the prompt does not shrink.
 */
export function cappedRecovery(
  fullTokens: number,
  removedTokens: number,
  capTokens: number | undefined,
): number {
  if (capTokens === undefined) return removedTokens;
  return Math.max(
    0,
    Math.min(fullTokens, capTokens) - Math.min(Math.max(0, fullTokens - removedTokens), capTokens),
  );
}
