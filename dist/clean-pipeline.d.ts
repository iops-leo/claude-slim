/**
 * Name the fragments of a selection that were thrown away.
 *
 * Silence here is dangerous in one direction only: the user believes they
 * selected more than they did, sees a short confirmation, and assumes the rest
 * is coming. Keywords (`all`, `none`, empty) are handled by the resolvers and
 * are not fragments, so they are not reported as invalid.
 */
export declare function warnIgnoredSelection(input: string, count: number): void;
/**
 * Resolve which directory's project memory counts toward the startup estimate.
 *
 * Warns when the CLI is running from its own install directory and no explicit
 * directory was given: the slug would resolve to the plugin cache, match no
 * project, and silently zero out every project-memory token. Warning beats
 * guessing — we cannot know which project the user meant.
 *
 * A `--project-dir` that does not exist is a hard error rather than a warning.
 * The slug is derived from the path string, so a typo happily resolves to a
 * slug that matches nothing and reports 0 — reintroducing, through the very
 * flag added to prevent it, the silent zero of v2.12.1. An explicit flag with a
 * bad value is unambiguously a mistake, so fail instead of guessing.
 */
export declare function resolveProjectDir(explicit?: string): string | undefined;
export declare function runCleanPipeline(opts: {
    dryRun: boolean;
    auto: boolean;
    sessionsPerDay: number;
    lookbackDays: number;
    /** false skips ~/.codex entirely. */
    codex: boolean;
    /** Directory whose project memory counts; defaults to cwd. */
    projectDir?: string;
}): Promise<void>;
export declare function askUser(prompt: string): Promise<string>;
