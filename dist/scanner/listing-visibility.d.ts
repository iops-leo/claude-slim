import type { Issue, SkillInfo } from '../types.js';
import type { MeasuredStartup } from './measured-startup.js';
import { type SkillUsageRecord } from './listing-budget.js';
export declare function bytesPerTokenForModel(model: string | undefined): number;
export interface BudgetSettings {
    /** `SLASH_COMMAND_TOOL_CHAR_BUDGET`, from settings `env` or the environment. */
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
 * rendered — a rendered listing never exceeds its budget. Only trustworthy as
 * an exact figure when the listing overflowed; otherwise it is a lower bound.
 */
export declare function inferBudgetChars(m: MeasuredStartup, s: BudgetSettings): InferredBudget;
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
    entrypoint?: string;
    fromOtherProject: boolean;
    skillCount: number;
    listingChars: number;
    listingWidth: number;
    listingTokens: number;
    budgetChars: number;
    budgetBasis: InferredBudget['basis'];
    /** Skills shown without a description because the budget ran out. */
    collapsed: CollapsedSkill[];
    /** Skills the user set to `name-only` — shown that way by choice, not by the budget. */
    nameOnlyByChoice: number;
    /**
     * Present only when the listing overflowed: what it costs at the budget, and
     * what it would cost with every hidden description shown. Below the budget
     * neither applies — the listing costs exactly what its lines add up to.
     */
    overBudget?: {
        capTokens: number;
        fullTokens: number;
    };
    /** Descriptions that would come back if every skill flagged unused were cleaned. */
    restoredIfFlaggedCleaned: number;
}
export interface VisibilityContext {
    localSkills: SkillInfo[];
    pluginSkills: SkillInfo[];
    syncedSkills: SkillInfo[];
    issues: Issue[];
    skillUsage: Record<string, SkillUsageRecord>;
    settings: BudgetSettings & {
        skillOverrides?: Record<string, unknown>;
    };
    now: number;
}
export declare function analyzeListingVisibility(m: MeasuredStartup | null, ctx: VisibilityContext): ListingVisibility | null;
/** The skill listing never costs more than its budget. */
export declare function cappedListingTokens(fullTokens: number, capTokens: number | undefined): number;
/**
 * Startup tokens actually freed by removing `removedTokens` of listing from a
 * listing worth `fullTokens` uncapped. While the listing stays over budget,
 * removal only lets other descriptions back in — the prompt does not shrink.
 */
export declare function cappedRecovery(fullTokens: number, removedTokens: number, capTokens: number | undefined): number;
