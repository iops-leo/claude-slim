import { homedir } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
import { getClaudeDir, getConfigDirOverride } from '../paths.js';
import { safeReadFile, isDirectory } from './fs-walk.js';
export function isObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export async function readJson(path) {
    const content = await safeReadFile(path);
    if (!content)
        return null;
    try {
        const parsed = JSON.parse(content);
        return isObject(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
export function stringList(container, key) {
    const v = container?.[key];
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}
export function firstBoolean(sources, key) {
    for (const s of sources) {
        const v = s?.[key];
        if (typeof v === 'boolean')
            return v;
    }
    return undefined;
}
export function firstString(sources, key) {
    for (const s of sources) {
        const v = s?.[key];
        if (typeof v === 'string' && v.length > 0)
            return v;
    }
    return undefined;
}
export function getManagedDir(platform = process.platform) {
    if (platform === 'darwin')
        return '/Library/Application Support/ClaudeCode';
    if (platform === 'win32')
        return 'C:\\Program Files\\ClaudeCode';
    return '/etc/claude-code';
}
/** `.claude.json` — beside `~/.claude`, or inside `CLAUDE_CONFIG_DIR` when set. */
export function getClaudeJsonPath() {
    return join(getConfigDirOverride() ?? homedir(), '.claude.json');
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
export async function findRepoRoot(dir) {
    let current = dir;
    for (;;) {
        const gitPath = join(current, '.git');
        if (await isDirectory(gitPath))
            return current;
        const gitFile = await safeReadFile(gitPath);
        const gitdir = gitFile?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
        if (gitdir) {
            const absGitdir = isAbsolute(gitdir) ? gitdir : resolve(current, gitdir);
            const common = (await safeReadFile(join(absGitdir, 'commondir')))?.trim();
            return common ? dirname(resolve(absGitdir, common)) : current;
        }
        const parent = dirname(current);
        if (parent === current)
            return null;
        current = parent;
    }
}
async function ownedByMe(path) {
    try {
        return (await stat(path)).uid === process.getuid?.();
    }
    catch {
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
async function localSettingsPaths(dir, repoRoot) {
    const atDir = join(dir, '.claude', 'settings.local.json');
    if (!repoRoot || repoRoot === homedir() || process.platform === 'win32')
        return [atDir];
    const owned = await Promise.all([repoRoot, join(repoRoot, '.git'), join(repoRoot, '.claude')].map(ownedByMe));
    if (owned.includes(false))
        return [atDir];
    const atRoot = join(repoRoot, '.claude', 'settings.local.json');
    return atRoot === atDir ? [atDir] : [atRoot, atDir];
}
/** `~/.claude.json` keys projects with forward slashes on every platform. */
function projectKeyCandidates(root, dir) {
    const keys = [root, dir];
    return [...new Set([...keys, ...keys.map((k) => k.replace(/\\/g, '/'))])];
}
function trustedAt(projects, path) {
    const keys = [path, path.replace(/\\/g, '/')];
    return keys.some((k) => isObject(projects[k]) && projects[k].hasTrustDialogAccepted === true);
}
function parentTrusted(projects, dir, repoRoot) {
    let current = dir;
    for (;;) {
        if (trustedAt(projects, current))
            return true;
        if (repoRoot && current === repoRoot)
            return false; // nested repo: stop at its root
        const parent = dirname(current);
        if (parent === current)
            return false;
        current = parent;
    }
}
export async function readSettingsSources(projectDir, managedDir = getManagedDir()) {
    const dir = resolve(projectDir);
    const repoRoot = await findRepoRoot(dir);
    const root = repoRoot ?? dir;
    const localPaths = await localSettingsPaths(dir, repoRoot);
    const localAtRepoRoot = localPaths[0] !== join(dir, '.claude', 'settings.local.json');
    const [claudeJson, userSettings, projectSettings, localSettingsList, managedSettings] = await Promise.all([
        readJson(getClaudeJsonPath()),
        readJson(join(getClaudeDir(), 'settings.json')),
        readJson(join(dir, '.claude', 'settings.json')),
        Promise.all(localPaths.map(readJson)),
        readJson(join(managedDir, 'managed-settings.json')),
    ]);
    const projects = isObject(claudeJson?.projects) ? claudeJson.projects : {};
    const projectKey = projectKeyCandidates(root, dir).find((k) => isObject(projects[k]));
    const projectState = projectKey ? projects[projectKey] : null;
    return {
        dir,
        repoRoot,
        root,
        claudeJson,
        userSettings,
        projectSettings,
        localSettingsList,
        localAtRepoRoot,
        managedSettings,
        projectKey,
        projectState,
        trusted: projectState?.hasTrustDialogAccepted === true,
        trustedForHooks: projectState?.hasTrustDialogAccepted === true || parentTrusted(projects, dir, repoRoot),
    };
}
