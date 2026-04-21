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
