import type { UserSurfaceEntry } from './scanner/user-surfaces.js';
import type { AgentId } from './paths.js';

export type { UserSurfaceEntry, AgentId };

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
  source: 'local' | 'plugin';
  pluginName?: string;
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
  tokens: number;
}

export interface PluginInfo {
  name: string;
  skillCount: number;
  skills: string[];
  status?: 'enabled' | 'disabled';
}

export type IssueTier = 1 | 2 | 3;

export type IssueType =
  | 'broken_symlink'
  | 'template'
  | 'skill_dup'
  | 'duplicate'
  | 'oversized_memory'
  | 'oversized_skill'
  | 'unused_skill'
  | 'unused_plugin'
  | 'disabled_plugin'
  | 'stale_project'
  | 'temp_cache'
  | 'backup_artifact';

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
  plugins: PluginInfo[];
  brokenSymlinks: BrokenSymlink[];
  memoryFiles: MemoryFile[];
  claudeMdBytes: number;
  claudeMdTokens: number;
  claudeMdSections: Array<{ name: string; sizeBytes: number; tokens: number }>;
  mcpServers: number;
  mcpServerNames: string[];
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
}

// Flat "skill/memory moved" record written by the cleaner.
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

// Alias used by cleaner.ts (linter renamed the import).
export type LegacyManifestEntry = ManifestEntry;

export interface DisabledPluginEntry {
  type: 'disabled_plugin';
  plugin: string;
  marketplace: string;
  disabledAt: string;
}

export type AnyManifestEntry = ManifestEntry | DisabledPluginEntry;

export interface Manifest {
  version: 2;
  entries: AnyManifestEntry[];
}

export interface TokenCache {
  version: number;
  entries: Record<string, { hash: string; tokens: number }>;
}
