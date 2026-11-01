import { homedir } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';
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
 * Falls back to `dir` outside a repository.
 */
export async function findProjectRoot(dir) {
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
            return dir;
        current = parent;
    }
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
    const [root, claudeJson, userSettings, projectSettings, localSettings, managedMcp, managedSettings, mcpJsons] = await Promise.all([
        findProjectRoot(dir),
        readJson(claudeJsonPath),
        readJson(join(getClaudeDir(), 'settings.json')),
        readJson(join(dir, '.claude', 'settings.json')),
        readJson(join(dir, '.claude', 'settings.local.json')),
        readJson(managedMcpPath),
        readJson(managedSettingsPath),
        Promise.all(ancestorMcpJsonPaths(dir).map(async (p) => ({ path: p, data: await readJson(p) }))),
    ]);
    const projects = isObject(claudeJson?.projects) ? claudeJson.projects : {};
    const projectKey = projectKeyCandidates(root, dir).find((k) => isObject(projects[k]));
    const projectState = projectKey ? projects[projectKey] : null;
    // A cloned repo cannot approve its own servers: approvals committed to its
    // .claude/settings.json count only once the folder is trusted.
    const trusted = projectState?.hasTrustDialogAccepted === true;
    const committed = trusted ? projectSettings : null;
    // Highest precedence first: managed, local, project, user, then the
    // per-project state older Claude Code versions wrote approvals to.
    const settingsByPrecedence = [managedSettings, localSettings, committed, userSettings, projectState];
    const disabledByToggle = new Set(stringList(projectState, 'disabledMcpServers'));
    const mcpjsonDisabled = new Set(settingsByPrecedence.flatMap((s) => stringList(s, 'disabledMcpjsonServers')));
    const mcpjsonEnabled = new Set(settingsByPrecedence.flatMap((s) => stringList(s, 'enabledMcpjsonServers')));
    const enableAll = firstBoolean(settingsByPrecedence, 'enableAllProjectMcpServers') === true;
    const policySources = [managedSettings, localSettings, projectSettings, userSettings];
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
    return { count: names.length, names, servers, notLoaded, policyNotEvaluated };
}
