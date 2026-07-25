export declare function getClaudeDir(): string;
export declare function getSkillsDir(): string;
export declare function getPluginsDir(): string;
export declare function getProjectsDir(): string;
export declare function getDisabledDir(): string;
/**
 * Claude Code stores per-project state under `~/.claude/projects/<slug>/`,
 * where the slug is the absolute project path with every `/` replaced by `-`
 * (e.g. `/Users/me/app` → `-Users-me-app`).
 *
 * Only the current project's `memory/` is loaded into a session — which is why
 * the startup estimate must not sum memory across every project on disk.
 */
export declare function getCurrentProjectSlug(cwd?: string): string;
export declare function getManifestPath(): string;
export declare function getLegacyManifestPath(): string;
export declare function assertInsideClaudeDir(p: string): void;
