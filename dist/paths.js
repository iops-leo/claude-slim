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
// Refuse to operate on a path outside ~/.claude/. Guards destructive operations
// (rename/rm/unlink) from acting on attacker-tampered manifests or scanner bugs.
export function assertInsideClaudeDir(p) {
    const resolved = resolve(p);
    const root = resolve(getClaudeDir());
    if (resolved !== root && !resolved.startsWith(root + sep)) {
        throw new Error(`Refusing to operate on path outside ~/.claude/: ${p}`);
    }
}
