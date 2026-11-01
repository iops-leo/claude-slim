import { homedir } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
import { getClaudeDir } from '../paths.js';
import { safeReadFile, isDirectory } from './fs-walk.js';

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

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function readJson(path: string): Promise<Json | null> {
  const content = await safeReadFile(path);
  if (!content) return null;
  try {
    const parsed: unknown = JSON.parse(content);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Server names whose definition is an object — anything else never loads. */
function serverNames(container: Json | null | undefined, key = 'mcpServers'): string[] {
  const servers = container?.[key];
  if (!isObject(servers)) return [];
  return Object.keys(servers).filter((name) => isObject(servers[name]));
}

function stringList(container: Json | null | undefined, key: string): string[] {
  const v = container?.[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function objectList(container: Json | null | undefined, key: string): Json[] {
  const v = container?.[key];
  return Array.isArray(v) ? v.filter(isObject) : [];
}

/**
 * Tool-name prefix for a server. Claude Code replaces every character outside
 * `A-Za-z0-9_-` with `_` (documented for plugin servers; the same rule shows in
 * connector tools such as `mcp__claude_ai_Gmail__…`).
 */
export function mcpToolPrefix(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function getManagedDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode';
  return '/etc/claude-code';
}

export function getClaudeJsonPath(): string {
  return join(homedir(), '.claude.json');
}

/** `.mcp.json` paths from `dir` up to the filesystem root, nearest first. */
function ancestorMcpJsonPaths(dir: string): string[] {
  const paths: string[] = [];
  let current = dir;
  for (;;) {
    paths.push(join(current, '.mcp.json'));
    const parent = dirname(current);
    if (parent === current) return paths;
    current = parent;
  }
}

/**
 * The repository root Claude Code files per-project state under: the nearest
 * ancestor holding `.git`, and for a linked worktree the main checkout it
 * belongs to. A local server added at the repo root is live in every
 * subdirectory and worktree; looking it up by the literal cwd missed it.
 * Null outside a repository.
 */
export async function findRepoRoot(dir: string): Promise<string | null> {
  let current = dir;
  for (;;) {
    const gitPath = join(current, '.git');
    if (await isDirectory(gitPath)) return current;
    const gitFile = await safeReadFile(gitPath);
    const gitdir = gitFile?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
    if (gitdir) {
      const absGitdir = isAbsolute(gitdir) ? gitdir : resolve(current, gitdir);
      const common = (await safeReadFile(join(absGitdir, 'commondir')))?.trim();
      return common ? dirname(resolve(absGitdir, common)) : current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * `.claude/settings.local.json` locations, highest precedence first. Inside a
 * repository Claude Code keeps it at the repo root (the main checkout for a
 * worktree) and still reads one an older version left in the starting
 * directory; outside a repo, when the root is the home directory, on Windows,
 * or when the root, its `.git` or `.claude` is not owned by the current user,
 * it stays next to `.claude/settings.json`.
 * https://code.claude.com/docs/en/settings.md — "Where Claude Code keeps the
 * local file in a git repository".
 */
async function ownedByMe(path: string): Promise<boolean> {
  try {
    return (await stat(path)).uid === process.getuid?.();
  } catch {
    return true; // absent entries do not disqualify the root
  }
}

async function localSettingsPaths(dir: string, repoRoot: string | null): Promise<string[]> {
  const atDir = join(dir, '.claude', 'settings.local.json');
  if (!repoRoot || repoRoot === homedir() || process.platform === 'win32') return [atDir];
  // A shared checkout owned by someone else keeps the file next to settings.json.
  const owned = await Promise.all(
    [repoRoot, join(repoRoot, '.git'), join(repoRoot, '.claude')].map(ownedByMe),
  );
  if (owned.includes(false)) return [atDir];
  const atRoot = join(repoRoot, '.claude', 'settings.local.json');
  return atRoot === atDir ? [atDir] : [atRoot, atDir];
}

/** `~/.claude.json` keys projects with forward slashes on every platform. */
function projectKeyCandidates(root: string, dir: string): string[] {
  const keys = [root, dir];
  return [...new Set([...keys, ...keys.map((k) => k.replace(/\\/g, '/'))])];
}

function firstBoolean(sources: Array<Json | null | undefined>, key: string): boolean | undefined {
  for (const s of sources) {
    const v = s?.[key];
    if (typeof v === 'boolean') return v;
  }
  return undefined;
}

export async function scanMcpServers(
  projectDir: string = process.cwd(),
  opts: McpScanOptions = {},
): Promise<McpScanResult> {
  const dir = resolve(projectDir);
  const managedDir = opts.managedDir ?? getManagedDir();
  const claudeJsonPath = getClaudeJsonPath();
  const managedMcpPath = join(managedDir, 'managed-mcp.json');
  const managedSettingsPath = join(managedDir, 'managed-settings.json');

  const repoRoot = await findRepoRoot(dir);
  const root = repoRoot ?? dir;
  const [claudeJson, userSettings, projectSettings, localSettingsList, managedMcp, managedSettings, mcpJsons] =
    await Promise.all([
      readJson(claudeJsonPath),
      readJson(join(getClaudeDir(), 'settings.json')),
      readJson(join(dir, '.claude', 'settings.json')),
      localSettingsPaths(dir, repoRoot).then((paths) => Promise.all(paths.map(readJson))),
      readJson(managedMcpPath),
      readJson(managedSettingsPath),
      Promise.all(ancestorMcpJsonPaths(dir).map(async (p) => ({ path: p, data: await readJson(p) }))),
    ]);

  const projects = isObject(claudeJson?.projects) ? claudeJson.projects : {};
  const projectKey = projectKeyCandidates(root, dir).find((k) => isObject(projects[k]));
  const projectState = projectKey ? (projects[projectKey] as Json) : null;

  // .mcp.json approval (https://code.claude.com/docs/en/mcp.md, "Project
  // server approvals and workspace trust"): a cloned repo cannot approve its
  // own servers. Approvals in the committed .claude/settings.json need trust;
  // so do approvals in settings.local.json, unless the folder is the home
  // directory. User and managed approvals always count. Denials
  // (disabledMcpjsonServers) count from every file regardless of trust.
  const trusted = projectState?.hasTrustDialogAccepted === true;
  const localTrusted = trusted || dir === homedir();
  const approvalsByPrecedence = [
    managedSettings,
    ...(localTrusted ? localSettingsList : []),
    trusted ? projectSettings : null,
    userSettings,
    projectState, // where older Claude Code versions wrote approvals
  ];
  const allSettings = [managedSettings, ...localSettingsList, projectSettings, userSettings, projectState];

  const disabledByToggle = new Set(stringList(projectState, 'disabledMcpServers'));
  const mcpjsonDisabled = new Set(allSettings.flatMap((s) => stringList(s, 'disabledMcpjsonServers')));
  const mcpjsonEnabled = new Set(approvalsByPrecedence.flatMap((s) => stringList(s, 'enabledMcpjsonServers')));
  // Trusted: the highest-precedence boolean wins, so a local `false` beats a
  // user `true`. Untrusted: a `true` in any honored file is enough.
  // https://code.claude.com/docs/en/settings-reference.md#enableallprojectmcpservers
  const enableAll = trusted
    ? firstBoolean(approvalsByPrecedence, 'enableAllProjectMcpServers') === true
    : approvalsByPrecedence.some((s) => s?.enableAllProjectMcpServers === true);

  const policySources = [managedSettings, ...localSettingsList, projectSettings, userSettings];
  const denied = policySources.flatMap((s) => objectList(s, 'deniedMcpServers'));
  const deniedNames = new Set(denied.map((e) => e.serverName).filter((n): n is string => typeof n === 'string'));
  const policyNotEvaluated =
    denied.some((e) => 'serverUrl' in e || 'serverCommand' in e) ||
    policySources.some((s) => Array.isArray(s?.allowedMcpServers));

  const exclusive = managedMcp !== null;
  const byName = new Map<string, McpServerEntry>();
  const add = (name: string, scope: McpScope, path: string, base: McpStatus): void => {
    if (byName.has(name)) return; // callers add in precedence order
    let status = base;
    if (deniedNames.has(name) || (exclusive && scope !== 'managed')) status = 'blocked';
    else if (disabledByToggle.has(name)) status = 'disabled';
    byName.set(name, { name, scope, path, status, toolPrefix: mcpToolPrefix(name) });
  };

  // Same name in several places: managed-mcp.json, then managedMcpServers,
  // then local, project, user.
  for (const name of serverNames(managedMcp)) add(name, 'managed', managedMcpPath, 'active');
  for (const name of serverNames(managedSettings, 'managedMcpServers')) add(name, 'managed', managedSettingsPath, 'active');
  for (const name of serverNames(projectState)) add(name, 'local', claudeJsonPath, 'active');
  for (const { path, data } of mcpJsons) {
    for (const name of serverNames(data)) {
      const status: McpStatus = mcpjsonDisabled.has(name)
        ? 'disabled'
        : enableAll || mcpjsonEnabled.has(name)
          ? 'active'
          : 'pending';
      add(name, 'project', path, status);
    }
  }
  for (const name of serverNames(claudeJson)) add(name, 'user', claudeJsonPath, 'active');

  const servers = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const names = servers.filter((s) => s.status === 'active').map((s) => s.name);
  const notLoaded = serverNames(userSettings).filter((n) => !byName.has(n)).sort();

  return { count: names.length, names, servers, notLoaded, policyNotEvaluated, projectKey: projectKey ?? root.replace(/\\/g, '/') };
}
