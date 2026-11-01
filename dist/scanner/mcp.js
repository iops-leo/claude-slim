import { homedir } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
import { getClaudeDir } from '../paths.js';
import { safeReadFile, isDirectory } from './fs-walk.js';
function isObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
async function readJson(path) {
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
/** Server names whose definition is an object — anything else never loads. */
function serverNames(container, key = 'mcpServers') {
    const servers = container?.[key];
    if (!isObject(servers))
        return [];
    return Object.keys(servers).filter((name) => isObject(servers[name]));
}
function stringList(container, key) {
    const v = container?.[key];
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}
function objectList(container, key) {
    const v = container?.[key];
    return Array.isArray(v) ? v.filter(isObject) : [];
}
/**
 * Tool-name prefix for a server. Claude Code replaces every character outside
 * `A-Za-z0-9_-` with `_` (documented for plugin servers; the same rule shows in
 * connector tools such as `mcp__claude_ai_Gmail__…`).
 */
export function mcpToolPrefix(name) {
    return name.replace(/[^A-Za-z0-9_-]/g, '_');
}
export function getManagedDir(platform = process.platform) {
    if (platform === 'darwin')
        return '/Library/Application Support/ClaudeCode';
    if (platform === 'win32')
        return 'C:\\Program Files\\ClaudeCode';
    return '/etc/claude-code';
}
export function getClaudeJsonPath() {
    return join(homedir(), '.claude.json');
}
/** `.mcp.json` paths from `dir` up to the filesystem root, nearest first. */
function ancestorMcpJsonPaths(dir) {
    const paths = [];
    let current = dir;
    for (;;) {
        paths.push(join(current, '.mcp.json'));
        const parent = dirname(current);
        if (parent === current)
            return paths;
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
async function ownedByMe(path) {
    try {
        return (await stat(path)).uid === process.getuid?.();
    }
    catch {
        return true; // absent entries do not disqualify the root
    }
}
async function localSettingsPaths(dir, repoRoot) {
    const atDir = join(dir, '.claude', 'settings.local.json');
    if (!repoRoot || repoRoot === homedir() || process.platform === 'win32')
        return [atDir];
    // A shared checkout owned by someone else keeps the file next to settings.json.
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
function firstBoolean(sources, key) {
    for (const s of sources) {
        const v = s?.[key];
        if (typeof v === 'boolean')
            return v;
    }
    return undefined;
}
export async function scanMcpServers(projectDir = process.cwd(), opts = {}) {
    const dir = resolve(projectDir);
    const managedDir = opts.managedDir ?? getManagedDir();
    const claudeJsonPath = getClaudeJsonPath();
    const managedMcpPath = join(managedDir, 'managed-mcp.json');
    const managedSettingsPath = join(managedDir, 'managed-settings.json');
    const repoRoot = await findRepoRoot(dir);
    const root = repoRoot ?? dir;
    const [claudeJson, userSettings, projectSettings, localSettingsList, managedMcp, managedSettings, mcpJsons] = await Promise.all([
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
    const projectState = projectKey ? projects[projectKey] : null;
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
    const deniedNames = new Set(denied.map((e) => e.serverName).filter((n) => typeof n === 'string'));
    const policyNotEvaluated = denied.some((e) => 'serverUrl' in e || 'serverCommand' in e) ||
        policySources.some((s) => Array.isArray(s?.allowedMcpServers));
    const exclusive = managedMcp !== null;
    const byName = new Map();
    const add = (name, scope, path, base) => {
        if (byName.has(name))
            return; // callers add in precedence order
        let status = base;
        if (deniedNames.has(name) || (exclusive && scope !== 'managed'))
            status = 'blocked';
        else if (disabledByToggle.has(name))
            status = 'disabled';
        byName.set(name, { name, scope, path, status, toolPrefix: mcpToolPrefix(name) });
    };
    // Same name in several places: managed-mcp.json, then managedMcpServers,
    // then local, project, user.
    for (const name of serverNames(managedMcp))
        add(name, 'managed', managedMcpPath, 'active');
    for (const name of serverNames(managedSettings, 'managedMcpServers'))
        add(name, 'managed', managedSettingsPath, 'active');
    for (const name of serverNames(projectState))
        add(name, 'local', claudeJsonPath, 'active');
    for (const { path, data } of mcpJsons) {
        for (const name of serverNames(data)) {
            const status = mcpjsonDisabled.has(name)
                ? 'disabled'
                : enableAll || mcpjsonEnabled.has(name)
                    ? 'active'
                    : 'pending';
            add(name, 'project', path, status);
        }
    }
    for (const name of serverNames(claudeJson))
        add(name, 'user', claudeJsonPath, 'active');
    const servers = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    const names = servers.filter((s) => s.status === 'active').map((s) => s.name);
    const notLoaded = serverNames(userSettings).filter((n) => !byName.has(n)).sort();
    return { count: names.length, names, servers, notLoaded, policyNotEvaluated, projectKey: projectKey ?? root.replace(/\\/g, '/') };
}
