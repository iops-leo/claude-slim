import { join } from 'node:path';
import { getPluginsDir } from '../paths.js';
import { OVERSIZED_SKILL_BYTES, OVERSIZED_MEMORY_BYTES, SKILL_PROMPT_OVERHEAD_TOKENS, } from './constants.js';
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
            // Check base name for nested skills (e.g. "org/ship" → "ship")
            const baseName = skill.name.includes('/') ? skill.name.split('/').pop() : skill.name;
            if (pluginSkillNames.has(baseName)) {
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
export const detectors = [
    brokenSymlinkDetector,
    templateDetector,
    duplicateDetector,
    oversizedSkillDetector,
    skillDupDetector,
    tempCacheDetector,
    oversizedMemoryDetector,
    staleProjectDetector,
    disabledPluginDetector,
];
export function classifyIssues(ctx, registry = detectors) {
    const issues = registry.flatMap((d) => d.detect(ctx));
    issues.sort((a, b) => a.tier - b.tier);
    return issues;
}
