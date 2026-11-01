/**
 * Where Claude Code reads MCP server definitions from
 * (https://code.claude.com/docs/en/mcp.md, "MCP installation scopes";
 * https://code.claude.com/docs/en/managed-mcp.md):
 *
 *   user     `~/.claude.json` → `mcpServers`
 *   local    `~/.claude.json` → `projects[<project key>].mcpServers`
 *   project  `.mcp.json` in the working directory or any ancestor
 *   managed  `managed-mcp.json` (exclusive control) and `managedMcpServers` in
 *            `managed-settings.json`, both in a fixed per-OS directory
 *
 * Plugin servers are reported with their plugin (plugin-surfaces.ts), and
 * claude.ai connectors are fetched at runtime with no local file to read.
 *
 * `~/.claude/settings.json` is not on the list. Pre-2.15.2 that was the only
 * file read, so the scan listed a server Claude Code never loaded and missed
 * every real one.
 */
export type McpScope = 'local' | 'project' | 'user' | 'managed';
/**
 * `active`   loaded into sessions in this project
 * `disabled` turned off with `/mcp` (`disabledMcpServers`) or, for `.mcp.json`
 *            servers, listed in `disabledMcpjsonServers`
 * `pending`  a `.mcp.json` server not yet approved — interactive sessions skip it
 * `blocked`  excluded by managed policy: `managed-mcp.json` exclusive control,
 *            or a `deniedMcpServers` name entry
 */
export type McpStatus = 'active' | 'disabled' | 'pending' | 'blocked';
export interface McpServerEntry {
    name: string;
    scope: McpScope;
    /** File the definition was read from. */
    path: string;
    status: McpStatus;
    /** `<prefix>` in the `mcp__<prefix>__<tool>` names this server's tools get. */
    toolPrefix: string;
}
export interface McpScanResult {
    /** Active servers only — what a session in this project actually loads. */
    count: number;
    /** Names of the active servers, sorted. */
    names: string[];
    /** Every server found, sorted by name, one entry per name. */
    servers: McpServerEntry[];
    /**
     * Names under `mcpServers` in `~/.claude/settings.json`. Not a location
     * Claude Code reads servers from, so they are reported, not counted.
     */
    notLoaded: string[];
    /**
     * True when an allow/deny list holds `serverUrl` / `serverCommand` entries,
     * or an allowlist is set at all. Only `serverName` denials are evaluated, so
     * `active` may then include servers policy would block.
     */
    policyNotEvaluated: boolean;
    /** `~/.claude.json` project key for this directory — where local servers live. */
    projectKey: string;
}
export interface McpScanOptions {
    /** Directory holding `managed-mcp.json` / `managed-settings.json`. */
    managedDir?: string;
}
/**
 * Tool-name prefix for a server. Claude Code replaces every character outside
 * `A-Za-z0-9_-` with `_` (documented for plugin servers; the same rule shows in
 * connector tools such as `mcp__claude_ai_Gmail__…`).
 */
export declare function mcpToolPrefix(name: string): string;
export declare function getManagedDir(platform?: NodeJS.Platform): string;
export declare function getClaudeJsonPath(): string;
/**
 * The repository root Claude Code files per-project state under: the nearest
 * ancestor holding `.git`, and for a linked worktree the main checkout it
 * belongs to. A local server added at the repo root is live in every
 * subdirectory and worktree; looking it up by the literal cwd missed it.
 * Null outside a repository.
 */
export declare function findRepoRoot(dir: string): Promise<string | null>;
export declare function scanMcpServers(projectDir?: string, opts?: McpScanOptions): Promise<McpScanResult>;
