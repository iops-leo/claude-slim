import { homedir } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
import { getClaudeDir } from '../paths.js';
import { safeReadFile, isDirectory } from './fs-walk.js';

/**
 * The settings files and per-project state Claude Code consults for one
 * working directory. Shared by the MCP, synced-skill and memory scanners so
 * they agree on which project a directory belongs to and which files apply.
 * https://code.claude.com/docs/en/settings.md
 */

export type Json = Record<string, unknown>;

export function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export async function readJson(path: string): Promise<Json | null> {
  const content = await safeReadFile(path);
  if (!content) return null;
  try {
    const parsed: unknown = JSON.parse(content);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function stringList(container: Json | null | undefined, key: string): string[] {
  const v = container?.[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function firstBoolean(sources: Array<Json | null | undefined>, key: string): boolean | undefined {
  for (const s of sources) {
    const v = s?.[key];
    if (typeof v === 'boolean') return v;
  }
  return undefined;
}

export function firstString(sources: Array<Json | null | undefined>, key: string): string | undefined {
  for (const s of sources) {
    const v = s?.[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

export function getManagedDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode';
  return '/etc/claude-code';
}

export function getClaudeJsonPath(): string {
  return join(homedir(), '.claude.json');
}

/**
 * The repository root Claude Code files per-project state under: the nearest
 * ancestor holding `.git`, and for a linked worktree the main checkout it
 * belongs to. Null outside a repository.
 *
 * Auto memory, local MCP servers and the project-local settings file are all
 * keyed by this root, so every subdirectory and worktree shares them
 * (https://code.claude.com/docs/en/memory.md, "Storage location").
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

async function ownedByMe(path: string): Promise<boolean> {
  try {
    return (await stat(path)).uid === process.getuid?.();
  } catch {
    return true; // absent entries do not disqualify the root
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
async function localSettingsPaths(dir: string, repoRoot: string | null): Promise<string[]> {
  const atDir = join(dir, '.claude', 'settings.local.json');
  if (!repoRoot || repoRoot === homedir() || process.platform === 'win32') return [atDir];
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

export interface SettingsSources {
  /** The resolved working directory. */
  dir: string;
  repoRoot: string | null;
  /** `repoRoot ?? dir` — the project Claude Code files this directory under. */
  root: string;
  claudeJson: Json | null;
  userSettings: Json | null;
  /** `.claude/settings.json` in the working directory. */
  projectSettings: Json | null;
  /** `.claude/settings.local.json` files, highest precedence first. */
  localSettingsList: Array<Json | null>;
  managedSettings: Json | null;
  /** `~/.claude.json` → `projects[<key>]`, when present. */
  projectKey: string | undefined;
  projectState: Json | null;
  /** The workspace trust dialog was accepted for this project. */
  trusted: boolean;
  /**
   * Trust as applied to hooks-class settings (and `autoMemoryDirectory`): the
   * folder or a parent folder was trusted. A parent above the repository root
   * does not count — inside a nested repository Claude Code asks again.
   * https://code.claude.com/docs/en/permissions.md#what-runs-before-you-trust-a-folder
   */
  trustedForHooks: boolean;
}

function trustedAt(projects: Json, path: string): boolean {
  const keys = [path, path.replace(/\\/g, '/')];
  return keys.some((k) => isObject(projects[k]) && (projects[k] as Json).hasTrustDialogAccepted === true);
}

function parentTrusted(projects: Json, dir: string, repoRoot: string | null): boolean {
  let current = dir;
  for (;;) {
    if (trustedAt(projects, current)) return true;
    if (repoRoot && current === repoRoot) return false; // nested repo: stop at its root
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export async function readSettingsSources(
  projectDir: string,
  managedDir: string = getManagedDir(),
): Promise<SettingsSources> {
  const dir = resolve(projectDir);
  const repoRoot = await findRepoRoot(dir);
  const root = repoRoot ?? dir;
  const [claudeJson, userSettings, projectSettings, localSettingsList, managedSettings] = await Promise.all([
    readJson(getClaudeJsonPath()),
    readJson(join(getClaudeDir(), 'settings.json')),
    readJson(join(dir, '.claude', 'settings.json')),
    localSettingsPaths(dir, repoRoot).then((paths) => Promise.all(paths.map(readJson))),
    readJson(join(managedDir, 'managed-settings.json')),
  ]);
  const projects = isObject(claudeJson?.projects) ? claudeJson.projects : {};
  const projectKey = projectKeyCandidates(root, dir).find((k) => isObject(projects[k]));
  const projectState = projectKey ? (projects[projectKey] as Json) : null;
  return {
    dir,
    repoRoot,
    root,
    claudeJson,
    userSettings,
    projectSettings,
    localSettingsList,
    managedSettings,
    projectKey,
    projectState,
    trusted: projectState?.hasTrustDialogAccepted === true,
    trustedForHooks: projectState?.hasTrustDialogAccepted === true || parentTrusted(projects, dir, repoRoot),
  };
}
