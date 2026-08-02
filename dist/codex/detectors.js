import { join } from 'node:path';
import { getCodexDir } from '../paths.js';
import { OVERSIZED_SKILL_BYTES } from '../scanner/constants.js';
import { isDirectory, safeReaddir, getDirSize, isBrokenSymlink } from '../scanner/fs-walk.js';
// Codex cleanup candidates, in the same three tiers the Claude path uses.
//
// Five of Claude's seven categories carry over unchanged, because they are
// filesystem facts rather than usage inferences:
//
//   broken symlinks · empty templates · duplicates · oversized · install leftovers
//
// The two that do not:
//   unused_skill    — no invocation record exists in Codex session logs
//   oversized_memory— Codex has no ~/.codex/projects/*/memory/ equivalent
//
// Every issue produced here carries `agent: 'codex'`, which is what keeps the
// cleaner's path guard scoped to ~/.codex/ and unable to reach ~/.claude/.
const TEMPLATE_MARKER = 'Replace with description';
/** MB once it is worth calling MB; KB below that, so a 3KB leftover is not "0MB". */
function formatBytes(bytes) {
    const mb = bytes / 1024 / 1024;
    return mb >= 1 ? `${mb.toFixed(0)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}
function issue(type, tier, skill, detail) {
    return { type, tier, agent: 'codex', name: skill.name, path: skill.path, tokens: skill.tokens, detail };
}
/** Tier 1 — a SKILL.md symlink whose target is gone. Contributes nothing. */
export async function detectBrokenSymlinks(ctx) {
    const out = [];
    const skillsDir = join(getCodexDir(), 'skills');
    for (const entry of await safeReaddir(skillsDir)) {
        if (entry.startsWith('.'))
            continue;
        const dir = join(skillsDir, entry);
        if (!(await isDirectory(dir)))
            continue;
        const md = join(dir, 'SKILL.md');
        if (await isBrokenSymlink(md)) {
            out.push({
                type: 'broken_symlink', tier: 1, agent: 'codex',
                name: entry, path: md, tokens: 0, detail: 'dead symlink',
            });
        }
    }
    return out;
}
/** Tier 1 — a scaffold nobody filled in. */
export function detectTemplates(ctx) {
    return ctx.scan.skills
        .filter((s) => s.source === 'local')
        .filter((s) => ctx.contents.get(join(s.path, 'SKILL.md'))?.includes(TEMPLATE_MARKER))
        .map((s) => issue('template', 1, s, 'unfilled template'));
}
/**
 * Tier 1 — `~/.codex/.tmp`, where interrupted plugin installs accumulate.
 * Sized rather than token-counted: this is disk, not context.
 */
export async function detectInstallLeftovers() {
    const out = [];
    for (const name of ['.tmp', '.remote-plugin-install-staging']) {
        const path = join(getCodexDir(), name);
        if (!(await isDirectory(path)))
            continue;
        const bytes = await getDirSize(path);
        if (bytes === 0)
            continue;
        out.push({
            type: 'temp_cache', tier: 1, agent: 'codex',
            name, path, tokens: 0,
            detail: `${formatBytes(bytes)} of install leftovers`,
        });
    }
    return out;
}
/** Tier 2 — a leftover copy, recognised by name shape alone. */
export function detectBackups(ctx) {
    return ctx.scan.skills
        .filter((s) => s.source === 'local' && s.backupArtifact)
        .map((s) => issue('backup_artifact', 2, s, `looks like a backup copy (${s.backupArtifact})`));
}
/**
 * Tier 2 — a local skill shadowed by a plugin-provided one of the same name.
 * Removing the local copy leaves the plugin version in place.
 */
export function detectDuplicates(ctx) {
    const fromPlugins = new Set(ctx.scan.skills.filter((s) => s.source === 'plugin').map((s) => s.name));
    return ctx.scan.skills
        .filter((s) => s.source === 'local' && fromPlugins.has(s.name))
        .map((s) => issue('duplicate', 2, s, 'also provided by a plugin'));
}
/** Tier 3 — large enough to be worth a look, but possibly still in use. */
export function detectOversized(ctx) {
    return ctx.scan.skills
        .filter((s) => s.source === 'local' && s.sizeBytes > OVERSIZED_SKILL_BYTES)
        .map((s) => issue('oversized_skill', 3, s, `${Math.round(s.sizeBytes / 1024)}KB`));
}
export async function classifyCodexIssues(ctx) {
    const [symlinks, leftovers] = await Promise.all([
        detectBrokenSymlinks(ctx),
        detectInstallLeftovers(),
    ]);
    return [
        ...symlinks,
        ...detectTemplates(ctx),
        ...leftovers,
        ...detectBackups(ctx),
        ...detectDuplicates(ctx),
        ...detectOversized(ctx),
    ].sort((a, b) => a.tier - b.tier || b.tokens - a.tokens);
}
