import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
export function getClaudeDir() {
    return join(homedir(), '.claude');
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
 * where the slug is the absolute project path with every `/` replaced by `-`
 * (e.g. `/Users/me/app` → `-Users-me-app`).
 *
 * Only the current project's `memory/` is loaded into a session — which is why
 * the startup estimate must not sum memory across every project on disk.
 */
export function getCurrentProjectSlug(cwd = process.cwd()) {
    return resolve(cwd).replace(/\//g, '-');
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
