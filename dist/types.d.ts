import type { UserSurfaceEntry } from './scanner/user-surfaces.js';
import type { RuleEntry } from './scanner/rules.js';
import type { ClaudeMdImport } from './scanner/claude-md-imports.js';
import type { AgentId } from './paths.js';
import type { McpServerEntry } from './scanner/mcp.js';
export type { UserSurfaceEntry, RuleEntry, ClaudeMdImport, AgentId, McpServerEntry };
export interface SkillInfo {
    name: string;
    path: string;
    sizeBytes: number;
    /** Full SKILL.md body tokens — what the skill costs once invoked. */
    tokens: number;
    /**
     * Tokens this skill adds to the system prompt just by being installed
     * (its `- <name>: <description>` listing line). Measured from the
     * frontmatter description; see scanner/skill-listing.ts.
     */
    listingTokens: number;
    /** `synced`: downloaded from claude.ai into skills/synced/<bucket>/; managed there, never cleaned here. */
    source: 'local' | 'plugin' | 'synced';
    /**
     * Cache directory this skill was found under — the *marketplace*, not the
     * plugin. Kept as-is because `plugins[]` and the `disabled_plugin` detector
     * match cache directories by this name (see parseDisabledPlugins).
     */
    pluginName?: string;
    /**
     * The actual plugin, e.g. `oh-my-claudecode` where `pluginName` is `omc`.
     *
     * Needed because enabled/disabled state is reported per plugin, not per
     * marketplace, and one marketplace can host both. Absent when the cache entry
     * has no plugin level to read it from.
     */
    plugin?: string;
}
export interface BrokenSymlink {
    name: string;
    path: string;
    target: string;
}
export interface MemoryFile {
    project: string;
    name: string;
    path: string;
    sizeBytes: number;
    /** Whole-file tokens — what a topic file costs once Claude reads it. */
    tokens: number;
    /** True for `MEMORY.md`, the only memory file loaded at session start. */
    isIndex: boolean;
    /**
     * Tokens this file adds at startup: the index's first 200 lines / 25KB,
     * and 0 for every topic file, which Claude reads on demand.
     */
    startupTokens: number;
    /** True when the index exceeds the startup cap and its tail is never loaded. */
    truncated: boolean;
}
export interface PluginInfo {
    name: string;
    skillCount: number;
    skills: string[];
    status?: 'enabled' | 'disabled';
}
export type IssueTier = 1 | 2 | 3;
export type IssueType = 'broken_symlink' | 'template' | 'skill_dup' | 'duplicate' | 'oversized_memory' | 'oversized_skill' | 'unused_skill' | 'unused_plugin' | 'unused_mcp' | 'disabled_plugin' | 'stale_project' | 'temp_cache' | 'backup_artifact';
export interface Issue {
    type: IssueType;
    /** Which agent root this issue lives under. Absent means Claude Code. */
    agent?: AgentId;
    tier: IssueTier;
    name: string;
    detail?: string;
    tokens: number;
    path: string;
    marketplace?: string;
    /**
     * `unused_mcp` only: the scope `claude mcp remove` targets. `path` is then
     * the project root for `local` (where the CLI must run) and `~/.claude.json`
     * for `user`.
     */
    mcpScope?: 'user' | 'local';
}
export interface PluginBreakdown {
    name: string;
    marketplace: string;
    tokens: number;
    skills: number;
    mcp: number;
    commands: number;
    lastUsed: 'used' | 'never';
    status: 'used' | 'unused' | 'agent-only' | 'insufficient data' | 'disabled';
}
export interface ScanResult {
    localSkills: SkillInfo[];
    pluginSkills: SkillInfo[];
    /** Skills synced from claude.ai that a session signed in here loads. Never cleaned. */
    syncedSkills: SkillInfo[];
    /** `skills/synced/<bucket>/` folders no session here loads (other accounts, sync off). */
    syncedBucketsInactive: Array<{
        bucket: string;
        skills: number;
        reason: string;
    }>;
    /** `autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY` — no memory loads. */
    autoMemoryDisabled: boolean;
    /** `autoMemoryDirectory`, when settings move this project's memory there. */
    autoMemoryDirectory?: string;
    plugins: PluginInfo[];
    brokenSymlinks: BrokenSymlink[];
    memoryFiles: MemoryFile[];
    claudeMdBytes: number;
    claudeMdTokens: number;
    claudeMdSections: Array<{
        name: string;
        sizeBytes: number;
        tokens: number;
    }>;
    /** Files `~/.claude/CLAUDE.md` pulls in via `@path`, transitively. */
    claudeMdImports: ClaudeMdImport[];
    /** Sum of `claudeMdImports[].tokens` — paid at startup next to CLAUDE.md. */
    claudeMdImportTokens: number;
    /** `~/.claude/rules/**\/*.md`, loaded at launch unless path-scoped. */
    userRules: RuleEntry[];
    /** Tokens of rules without `paths:` — in the session from the first turn. */
    rulesStartupTokens: number;
    /** Tokens of path-scoped rules — loaded only when a matching file is read. */
    rulesConditionalTokens: number;
    /** Active MCP servers for this project (user, local, approved project, managed). */
    mcpServers: number;
    /** Names of the active servers in `mcpServers`. */
    mcpServerNames: string[];
    /** Every server found across scopes, including disabled and pending ones. */
    mcpServerEntries: McpServerEntry[];
    /** `mcpServers` names in ~/.claude/settings.json — not a location Claude Code loads. */
    mcpServersNotLoaded: string[];
    /** An allow/deny list uses URL or command entries, which the scan does not evaluate. */
    mcpPolicyNotEvaluated: boolean;
    issues: Issue[];
    totalTokensBefore: number;
    pluginBreakdown: PluginBreakdown[];
    /** ~/.claude/agents/*.md — loaded into the system prompt as the agent catalog. */
    userAgents: UserSurfaceEntry[];
    /** ~/.claude/commands/*.md — loaded as the slash-command listing. */
    userCommands: UserSurfaceEntry[];
    /** Project slug (cwd with `/` → `-`) whose memory a session here would load. */
    currentProjectSlug: string;
    /**
     * Whether `~/.claude/projects/<currentProjectSlug>/` exists — i.e. whether
     * Claude Code holds any state for this project.
     *
     * When false, `currentProjectMemoryTokens` is 0 because nothing is stored
     * under this slug. That 0 is arithmetically correct either way; what the flag
     * adds is *why*. A directory Claude has never opened genuinely has no memory,
     * while a slug pointing somewhere the user did not mean — the plugin cache, a
     * git worktree — produces the same 0 for a very different reason. Consumers
     * of `--json` had no way to tell a scanned project from a mis-aimed one.
     */
    currentProjectKnown: boolean;
    /** Memory tokens actually loaded at startup — current project only. */
    currentProjectMemoryTokens: number;
    /** Memory tokens across every project on disk. Not a per-session cost. */
    allProjectsMemoryTokens: number;
    /**
     * Startup tokens that acting on every issue would actually recover.
     *
     * Deliberately NOT `sum(issues.tokens)`. Two things make that sum wrong:
     *   1. Issues are per-finding, not per-path — one skill can be flagged
     *      `duplicate` + `oversized_skill` + `unused_skill` and get counted 3×.
     *   2. `Issue.tokens` is the full SKILL.md body, which is only paid when the
     *      skill is invoked. Startup pays `listingTokens` — often ~80× smaller.
     * Summing raw issue tokens on a real machine produced 215,535 "savings"
     * against a 13,434-token startup total. This field is the honest number.
     */
    recoverableStartupTokens: number;
    /**
     * Skill-listing tokens belonging to plugins reported as disabled.
     *
     * Excluded from `totalTokensBefore` because a disabled plugin's skills are
     * not in the session catalog. Reported separately so the number does not just
     * vanish: it is what re-enabling everything would cost.
     */
    disabledPluginSkillTokens: number;
}
export interface ManifestEntry {
    date: string;
    /** Which agent root `from` belongs to. Absent means Claude Code (pre-2.11 entries). */
    agent?: AgentId;
    name: string;
    from: string;
    type: IssueType;
    tokenCount?: number;
    tier?: IssueTier;
}
export type LegacyManifestEntry = ManifestEntry;
export interface DisabledPluginEntry {
    type: 'disabled_plugin';
    plugin: string;
    marketplace: string;
    disabledAt: string;
}
/**
 * An MCP server removed by `unused_mcp`. The definition itself — which may
 * carry tokens in `env` or `headers` — is kept only in the 0600 file at
 * `backupPath`, never in the manifest.
 */
export interface DisabledMcpEntry {
    type: 'unused_mcp';
    name: string;
    scope: 'user' | 'local';
    /** Directory `claude mcp add-json` must run in to target the same scope. */
    cwd: string;
    backupPath: string;
    disabledAt: string;
}
export type AnyManifestEntry = ManifestEntry | DisabledPluginEntry | DisabledMcpEntry;
export interface Manifest {
    version: 2;
    entries: AnyManifestEntry[];
}
export interface TokenCache {
    version: number;
    entries: Record<string, {
        hash: string;
        tokens: number;
    }>;
}
