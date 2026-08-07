import type { Issue, ScanResult, SkillInfo } from '../types.js';
export interface ScanOptions {
    lookbackDays?: number;
    /**
     * Directory whose project memory counts toward the startup estimate.
     *
     * Defaults to `process.cwd()`, which is wrong whenever the CLI is launched
     * from its own install directory — the `/claude-slim` skill does exactly that
     * via `cd "${CLAUDE_PLUGIN_ROOT}"`, and every project-memory token silently
     * dropped out of the total as a result.
     */
    projectDir?: string;
}
export declare function scan(opts?: ScanOptions): Promise<ScanResult>;
/**
 * What acting on every issue would actually save at session start.
 *
 * Two corrections over a naive `sum(issues.tokens)`, both of which inflate:
 *
 * - **Per-path, not per-issue.** The detectors are independent, so one skill
 *   routinely earns several findings at once (`duplicate` + `oversized_skill` +
 *   `unused_skill`). Removing it once collects the saving once.
 * - **Listing tokens, not body tokens.** `Issue.tokens` is the whole SKILL.md,
 *   which is loaded only when the skill runs. Startup pays for the catalog
 *   line alone. Conflating the two overstated savings ~80× in practice.
 *
 * Memory issues count only when they belong to the current project — the same
 * per-project rule `totalTokensBefore` follows. Deletions that free disk but no
 * context (`broken_symlink`, `temp_cache`) contribute nothing here by design.
 *
 * Three separate overlaps have to be collapsed, since every one of them inflates:
 * the same skill path, the same plugin across cached versions, and a memory file
 * that its own stale project already accounts for.
 */
export declare function sumRecoverableStartupTokens(issues: Issue[], skills: SkillInfo[], currentProjectSlug: string): number;
