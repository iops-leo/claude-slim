import { homedir } from 'node:os';
import { statSync } from 'node:fs';
import { join, resolve, sep, basename, dirname } from 'node:path';
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
export function getConfigDirOverride() {
    const raw = process.env.CLAUDE_CONFIG_DIR;
    return raw ? resolve(raw) : undefined;
}
export function getClaudeDir() {
    return getConfigDirOverride() ?? join(homedir(), '.claude');
}
/**
 * The "configuration home": the home directory, or the directory whose
 * `.claude` is `CLAUDE_CONFIG_DIR`. An untracked `settings.local.json` there
 * applies before the folder is trusted.
 * https://code.claude.com/docs/en/permissions.md#when-your-local-settings-file-needs-trust
 */
/** True for a path inside a Claude Code plugins directory — the default one or this profile's. */
export function isUnderClaudePlugins(path) {
    const p = path.replace(/\\/g, '/');
    const own = join(getClaudeDir(), 'plugins').replace(/\\/g, '/') + '/';
    return p.includes('/.claude/plugins/') || p.startsWith(own);
}
export function isConfigHome(dir) {
    if (dir === homedir())
        return true;
    const override = getConfigDirOverride();
    return override !== undefined && basename(override) === '.claude' && dirname(override) === dir;
}
export function getSkillsDir() {
    return join(getClaudeDir(), 'skills');
}
export function getPluginsDir() {
    return join(getClaudeDir(), 'plugins', 'cache');
}
export function getProjectsDir() {
    return join(getClaudeDir(), 'projects');
}
export function getDisabledDir() {
    return join(getClaudeDir(), 'skills.disabled');
}
/**
 * Claude Code stores per-project state under `~/.claude/projects/<slug>/`,
 * where the slug is the absolute project path with every character outside
 * [A-Za-z0-9] replaced by `-` (e.g. `/Users/me/app` → `-Users-me-app`,
 * `C:\Program Files` → `C--Program-Files`).
 *
 * Replacing only `/` never matched on Windows, and missed POSIX paths with
 * `.`, `_` or spaces — the current project's memory then reported 0 (#20).
 */
export function slugifyProjectPath(absPath) {
    return absPath.replace(/[^A-Za-z0-9]/g, '-');
}
/**
 * Only the current project's `memory/` is loaded into a session — which is why
 * the startup estimate must not sum memory across every project on disk.
 */
export function getCurrentProjectSlug(cwd = process.cwd()) {
    return slugifyProjectPath(resolve(cwd));
}
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
export function looksLikeToolInstallDir(cwd = process.cwd()) {
    const p = resolve(cwd).replace(/\\/g, '/');
    return (isUnderClaudePlugins(p) ||
        p.includes('/_npx/') ||
        /\/node_modules\/claude-slim(\/|$)/.test(p));
}
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
export function projectDirError(p) {
    let st;
    try {
        st = statSync(p);
    }
    catch {
        return `--project-dir is not an existing directory: ${p}`;
    }
    if (!st.isDirectory())
        return `--project-dir is not a directory: ${p}`;
    return null;
}
export function getManifestPath() {
    return join(getDisabledDir(), 'manifest.json');
}
export function getLegacyManifestPath() {
    return join(getDisabledDir(), '.claude-slim-manifest.jsonl');
}
export function getCodexDir() {
    return join(homedir(), '.codex');
}
export function getAgentRoot(agent) {
    return agent === 'claude' ? getClaudeDir() : getCodexDir();
}
export function getAgentDisabledDir(agent) {
    return join(getAgentRoot(agent), 'skills.disabled');
}
function isInside(child, root) {
    const c = resolve(child);
    const r = resolve(root);
    return c === r || c.startsWith(r + sep);
}
/**
 * Refuse to operate on a path outside the given agent's root. Guards destructive
 * operations (rename/rm/unlink) against tampered manifests and scanner bugs.
 *
 * Deliberately per-agent rather than "inside any known root": a Codex issue must
 * not be able to reach into ~/.claude/ and vice versa. Widening this to a single
 * combined check would let one bad manifest entry cross between agents, which is
 * exactly the failure this exists to prevent.
 */
export function assertInsideAgentRoot(p, agent) {
    if (!isInside(p, getAgentRoot(agent))) {
        const label = agent === 'claude' ? '~/.claude/' : '~/.codex/';
        throw new Error(`Refusing to operate on path outside ${label}: ${p}`);
    }
}
/** Back-compat wrapper — the Claude path is by far the most common caller. */
export function assertInsideClaudeDir(p) {
    assertInsideAgentRoot(p, 'claude');
}
/** Which agent owns this path, or null if it belongs to neither. */
export function agentForPath(p) {
    if (isInside(p, getClaudeDir()))
        return 'claude';
    if (isInside(p, getCodexDir()))
        return 'codex';
    return null;
}
