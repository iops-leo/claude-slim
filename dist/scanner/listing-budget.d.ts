export declare const DEFAULT_BUDGET_FRACTION = 0.01;
export declare const DEFAULT_CONTEXT_WINDOW = 200000;
export interface BudgetInputs {
    contextWindowTokens?: number;
    /** 3 for current models, 4 for claude-3.x and the 4.0–4.6 family. */
    bytesPerToken: number;
    /** `skillListingBudgetFraction` from settings. */
    fraction?: number;
    /** Raw `SLASH_COMMAND_TOOL_CHAR_BUDGET` value. */
    envOverride?: string;
}
export declare function listingBudgetChars(inputs: BudgetInputs): number;
export interface SkillUsageRecord {
    usageCount: number;
    lastUsedAt: number;
}
export declare function skillPriority(usage: SkillUsageRecord | undefined, now: number): number;
/** Terminal display width: wide characters count 2, combining marks 0. */
export declare function displayWidth(text: string): number;
