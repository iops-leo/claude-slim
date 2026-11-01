/**
 * `CLAUDE_CONFIG_DIR`, resolved to an absolute path, or undefined when unset.
 * Claude Code then keeps everything that normally lives under `~/.claude` —
 * and `.claude.json` — in that directory
 * (https://code.claude.com/docs/en/claude-directory.md).
 *
 * The value is taken as Claude Code takes it: no trimming and no `~`
 * expansion (a shell expands `~` before either program sees it; a settings
 * `env` block does not, and Claude Code then uses it literally). A relative
 * value resolves against this process's cwd, and the `claude` children we
 * spawn get that absolute path so they cannot resolve it elsewhere.
 */
export declare function getConfigDirOverride(): string | undefined;
export declare function getClaudeDir(): string;
/**
 * The "configuration home": the home directory, or the directory whose
 * `.claude` is `CLAUDE_CONFIG_DIR`. An untracked `settings.local.json` there
 * applies before the folder is trusted.
 * https://code.claude.com/docs/en/permissions.md#when-your-local-settings-file-needs-trust
 */
/** True for a path inside a Claude Code plugins directory — the default one or this profile's. */
export declare function isUnderClaudePlugins(path: string): boolean;
export declare function isConfigHome(dir: string): boolean;
export declare function getSkillsDir(): string;
export declare function getPluginsDir(): string;
export declare function getProjectsDir(): string;
export declare function getDisabledDir(): string;
/**
 * Claude Code stores per-project state under `~/.claude/projects/<slug>/`,
 * where the slug is the absolute project path with every character outside
 * [A-Za-z0-9] replaced by `-` (e.g. `/Users/me/app` → `-Users-me-app`,
 * `C:\Program Files` → `C--Program-Files`).
 *
 * Replacing only `/` never matched on Windows, and missed POSIX paths with
 * `.`, `_` or spaces — the current project's memory then reported 0 (#20).
 */
export declare function slugifyProjectPath(absPath: string): string;
/**
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
/**
 * Why an explicit `--project-dir` is unusable, or null when it is fine.
 *
 * The slug is a pure string transform of the path, so a typo resolves to a
 * perfectly well-formed slug that matches no project on disk and reports zero
 * project memory. That is the identical silent zero v2.12.1 was cut to fix,
 * reintroduced through the flag added to fix it. A non-existent explicit path
 * is unambiguously a mistake — worth an error, not a guess.
 *
 * A directory that exists but holds no memory is NOT an error: that is a real,
 * correctly-measured zero.
 */
export declare function projectDirError(p: string): string | null;
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
