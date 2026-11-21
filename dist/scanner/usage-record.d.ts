/**
 * Claude Code's own usage record in `.claude.json`:
 *
 *   skillUsage:  { "<skill>": { usageCount, lastUsedAt } }   plugin skills keyed `plugin:skill`
 *   pluginUsage: { "<plugin>@<marketplace>": { usageCount, lastUsedAt, ... } }
 *
 * `lastUsedAt` is epoch milliseconds. Unlike session transcripts, which Claude
 * Code deletes after `cleanupPeriodDays`, this record is kept, so it can vouch
 * for use the surviving logs no longer show. Read-only: never written here.
 */
export interface UsageRecord {
    /** Skill keys last used at or after the cutoff. */
    skills: Set<string>;
    /** `plugin@marketplace` identities with a recorded use at or after the cutoff. */
    plugins: Set<string>;
}
export declare function parseUsageRecord(claudeJson: unknown, cutoffMs: number): UsageRecord;
export declare function readUsageRecord(lookbackDays: number, now?: number): Promise<UsageRecord>;
