import { join } from 'node:path';
import { getPluginsDir } from '../paths.js';
import { OVERSIZED_SKILL_BYTES, OVERSIZED_MEMORY_BYTES, SKILL_PROMPT_OVERHEAD_TOKENS, } from './constants.js';
import { detectBackupArtifact } from './backup-artifacts.js';
const brokenSymlinkDetector = {
    name: 'broken_symlink',
    detect({ brokenSymlinks }) {
        return brokenSymlinks.map((link) => ({
            type: 'broken_symlink',
            tier: 1,
            name: link.name,
            detail: link.target,
            tokens: 0,
            path: link.path,
        }));
    },
};
const templateDetector = {
    name: 'template',
    detect({ localSkills, contents }) {
        const issues = [];
        for (const skill of localSkills) {
            const skillMdPath = join(skill.path, 'SKILL.md');
            const content = contents.get(skillMdPath);
            if (content && content.includes('Replace with description')) {
                issues.push({
                    type: 'template',
                    tier: 1,
                    name: skill.name,
                    tokens: skill.tokens,
                    path: skill.path,
                });
            }
        }
        return issues;
    },
};
const duplicateDetector = {
    name: 'duplicate',
    detect({ localSkills, pluginSkills }) {
        const pluginSkillNames = new Set(pluginSkills.map((s) => s.name));
        const issues = [];
        for (const skill of localSkills) {
            // Exact-name match only. A prior baseName fallback flagged nested local
            // skills (e.g. `org/ship`) as duplicates of a bare plugin `ship`, but
            // namespaced local skills are addressable independently and are not real
            // duplicates — the fallback risked disabling user content.
            if (pluginSkillNames.has(skill.name)) {
                issues.push({
                    type: 'duplicate',
                    tier: 2,
                    name: skill.name,
                    detail: 'local+plugin',
                    tokens: skill.tokens,
                    path: skill.path,
                });
            }
        }
        return issues;
    },
};
const oversizedSkillDetector = {
    name: 'oversized_skill',
    detect({ localSkills }) {
        const issues = [];
        for (const skill of localSkills) {
            if (skill.sizeBytes > OVERSIZED_SKILL_BYTES) {
                issues.push({
                    type: 'oversized_skill',
                    tier: 3,
                    name: skill.name,
                    detail: `${Math.round(skill.sizeBytes / 1024)}KB`,
                    tokens: skill.tokens,
                    path: skill.path,
                });
            }
        }
        return issues;
    },
};
const skillDupDetector = {
    name: 'skill_dup',
    detect({ localSkills }) {
        const issues = [];
        for (const skill of localSkills) {
            const dotSkillDir = skill.path + '.skill';
            if (localSkills.some((s) => s.path === dotSkillDir)) {
                issues.push({
                    type: 'skill_dup',
                    tier: 1,
                    name: skill.name,
                    tokens: 0,
                    path: dotSkillDir,
                });
            }
        }
        return issues;
    },
};
const tempCacheDetector = {
    name: 'temp_cache',
    detect({ tempCaches }) {
        return tempCaches.map((temp) => ({
            type: 'temp_cache',
            tier: 1,
            name: temp.name,
            detail: `${temp.sizeKB}KB`,
            tokens: 0,
            path: temp.path,
        }));
    },
};
const oversizedMemoryDetector = {
    name: 'oversized_memory',
    detect({ memoryFiles }) {
        const issues = [];
        for (const mem of memoryFiles) {
            if (mem.sizeBytes > OVERSIZED_MEMORY_BYTES) {
                issues.push({
                    type: 'oversized_memory',
                    tier: 2,
                    name: `${mem.project}/${mem.name}`,
                    detail: `${Math.round(mem.sizeBytes / 1024)}KB`,
                    tokens: mem.tokens,
                    path: mem.path,
                });
            }
        }
        return issues;
    },
};
const staleProjectDetector = {
    name: 'stale_project',
    detect({ staleProjects, memoryFiles }) {
        return staleProjects.map((stale) => {
            const memTokens = memoryFiles
                .filter((m) => m.project === stale.project)
                .reduce((sum, m) => sum + m.tokens, 0);
            return {
                type: 'stale_project',
                tier: 2,
                name: stale.project,
                detail: `${stale.ageDays}d, ${stale.fileCount} files, ${Math.round(stale.totalBytes / 1024)}KB`,
                tokens: memTokens,
                path: stale.path,
            };
        });
    },
};
const unusedSkillDetector = {
    name: 'unused_skill',
    detect({ localSkills, recentSkillInvocations, sessionDataAvailable, lookbackDays, }) {
        // Suppress entirely when the data source is unreliable — better no signal
        // than a wrong one that flags every skill as unused.
        if (!sessionDataAvailable)
            return [];
        const issues = [];
        for (const skill of localSkills) {
            // Direct hit: invocation set contains the skill name as-is.
            if (recentSkillInvocations.has(skill.name))
                continue;
            // Nested skill (e.g. "org/ship"): also check the bare leaf name, which
            // is how it would appear in a Skill tool_use input.
            if (skill.name.includes('/')) {
                const leaf = skill.name.split('/').pop();
                if (recentSkillInvocations.has(leaf))
                    continue;
            }
            issues.push({
                type: 'unused_skill',
                tier: 3,
                name: skill.name,
                detail: `not invoked in ${lookbackDays}d`,
                tokens: skill.tokens,
                path: skill.path,
            });
        }
        return issues;
    },
};
const unusedPluginDetector = {
    name: 'unused_plugin',
    detect({ pluginSurfaces, enabledPlugins, recentSkillInvocations, recentMcpPrefixes, recentCommands, totalUserCallableInvocations, sessionsInWindow, lookbackDays, pluginCosts, }) {
        // (a) Global suppression: too few sessions to draw a conclusion
        if (sessionsInWindow < 3)
            return [];
        // (b) Global suppression: no user-callable activity — schema change suspected
        if (totalUserCallableInvocations === 0)
            return [];
        const enabledNames = new Set(enabledPlugins.map((p) => p.name));
        const issues = [];
        for (const ps of pluginSurfaces) {
            // Inner-join: only consider plugins reported as enabled (filters .git noise)
            if (!enabledNames.has(ps.pluginName))
                continue;
            // (c) Per-plugin suppression: no user-callable surface (agent/hook only)
            const userCallableCount = ps.skills.length + ps.mcpToolPrefixes.length + ps.commands.length;
            if (userCallableCount === 0)
                continue;
            // (d) suppression was intended to skip recently-installed plugins by
            // `installedAt` mtime, but dogfooding showed `claude plugin update` resets
            // cache mtime indiscriminately, making install age unreliable. Dropped.
            // Tier 3 (never auto-selected) lets users sanity-check any flagged plugin.
            // Usage check: any skill/mcp/command from this plugin invoked?
            const usedSkill = ps.skills.some((s) => recentSkillInvocations.has(s) ||
                recentSkillInvocations.has(`${ps.pluginName}:${s}`));
            const usedMcp = ps.mcpToolPrefixes.some((p) => recentMcpPrefixes.has(p));
            const usedCmd = ps.commands.some((c) => recentCommands.has(c));
            if (usedSkill || usedMcp || usedCmd)
                continue;
            issues.push({
                type: 'unused_plugin',
                tier: 3,
                name: ps.pluginName,
                marketplace: ps.marketplace,
                detail: `not invoked in ${lookbackDays}d (${ps.marketplace})`,
                tokens: pluginCosts.get(ps.pluginName) ?? 0,
                path: ps.installDir,
            });
        }
        return issues;
    },
};
const disabledPluginDetector = {
    name: 'disabled_plugin',
    detect({ plugins, disabledPlugins }) {
        const issues = [];
        for (const plugin of plugins) {
            if (disabledPlugins.has(plugin.name)) {
                issues.push({
                    type: 'disabled_plugin',
                    tier: 2,
                    name: plugin.name,
                    detail: `${plugin.skillCount} skills`,
                    tokens: plugin.skillCount * SKILL_PROMPT_OVERHEAD_TOKENS,
                    path: join(getPluginsDir(), plugin.name),
                });
            }
        }
        return issues;
    },
};
// The full registry. Order only matters for ties in the tier sort.
// New detectors: define above, add here, update CONTRIBUTING.md's issue-type table.
// Backup leftovers are the one cleanup hint that needs no usage signal: a name
// like `foo.bak.20260711` announces itself. Tier 2 rather than Tier 1 — a
// backup still has some value, so the user confirms rather than it being
// pre-selected. The move is reversible via `restore` like any other skill.
const backupArtifactDetector = {
    name: 'backup_artifact',
    detect({ localSkills }) {
        const issues = [];
        for (const skill of localSkills) {
            const match = detectBackupArtifact(skill.name);
            if (!match)
                continue;
            issues.push({
                type: 'backup_artifact',
                tier: 2,
                name: skill.name,
                detail: `looks like a backup copy (${match.label})`,
                tokens: skill.tokens,
                path: skill.path,
            });
        }
        return issues;
    },
};
export const detectors = [
    brokenSymlinkDetector,
    templateDetector,
    duplicateDetector,
    oversizedSkillDetector,
    skillDupDetector,
    tempCacheDetector,
    oversizedMemoryDetector,
    staleProjectDetector,
    unusedSkillDetector,
    unusedPluginDetector,
    disabledPluginDetector,
    backupArtifactDetector,
];
export function classifyIssues(ctx, registry = detectors) {
    const issues = registry.flatMap((d) => d.detect(ctx));
    issues.sort((a, b) => a.tier - b.tier);
    return issues;
}
