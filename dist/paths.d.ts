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
/**
 * True when `cwd` sits inside claude-slim's own install rather than a project.
 *
 * The `/claude-slim` skill invokes the CLI with `cd "${CLAUDE_PLUGIN_ROOT}"`,
 * which makes `process.cwd()` the plugin cache directory. The project slug then
 * resolves to that path, no memory matches it, and the startup estimate silently
 * drops every project-memory token — 108,570 of them on the machine where this
 * was found. Detecting it lets the caller fail loudly or be told to pass
 * `--project-dir` instead of quietly reporting zero.
 */
export declare function looksLikeToolInstallDir(cwd?: string): boolean;
export declare function getManifestPath(): string;
export declare function getLegacyManifestPath(): string;
/** The agents claude-slim is allowed to touch. Adding one widens what every
 *  destructive operation may reach, so this list is the security boundary. */
export type AgentId = 'claude' | 'codex';
export declare function getCodexDir(): string;
export declare function getAgentRoot(agent: AgentId): string;
export declare function getAgentDisabledDir(agent: AgentId): string;
/**
 * Refuse to operate on a path outside the given agent's root. Guards destructive
 * operations (rename/rm/unlink) against tampered manifests and scanner bugs.
 *
 * Deliberately per-agent rather than "inside any known root": a Codex issue must
 * not be able to reach into ~/.claude/ and vice versa. Widening this to a single
 * combined check would let one bad manifest entry cross between agents, which is
 * exactly the failure this exists to prevent.
 */
export declare function assertInsideAgentRoot(p: string, agent: AgentId): void;
/** Back-compat wrapper — the Claude path is by far the most common caller. */
export declare function assertInsideClaudeDir(p: string): void;
/** Which agent owns this path, or null if it belongs to neither. */
export declare function agentForPath(p: string): AgentId | null;
