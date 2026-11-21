import type { SettingsSources } from './settings-sources.js';
import type { SkillUsageRecord } from './listing-budget.js';
export interface ListingSettings {
    fraction?: number;
    /** `SLASH_COMMAND_TOOL_CHAR_BUDGET` from a settings `env` block. */
    envBudget?: string;
    skillOverrides: Record<string, unknown>;
    skillUsage: Record<string, SkillUsageRecord>;
}
export declare function listingSettingsFrom(src: SettingsSources): ListingSettings;
