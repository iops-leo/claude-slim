import { join } from 'node:path';
import { statSync } from 'node:fs';
import { readFileSync, readdirSync } from 'node:fs';
import { getPluginsDir } from '../paths.js';
import { pickActiveVersion } from './plugin-versions.js';
import { listingTokensFromContent } from './skill-listing.js';
import { SKILL_PROMPT_OVERHEAD_TOKENS } from './constants.js';
function safeReaddir(p) {
    try {
        return readdirSync(p);
    }
    catch {
        return [];
    }
}
function safeStat(p) {
    try {
        return statSync(p);
    }
    catch {
        return null;
    }
}
function isDir(p) {
    const s = safeStat(p);
    return s != null && s.isDirectory();
}
function isFile(p) {
    const s = safeStat(p);
    return s != null && s.isFile();
}
function parseMcpServerKeys(installDir) {
    const mcpPath = join(installDir, '.mcp.json');
    if (!isFile(mcpPath))
        return [];
    try {
        const raw = readFileSync(mcpPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' &&
            parsed !== null &&
            'mcpServers' in parsed &&
            typeof parsed.mcpServers === 'object' &&
            parsed.mcpServers !== null) {
            return Object.keys(parsed.mcpServers);
        }
        return [];
    }
    catch {
        return [];
    }
}
function scanSkills(installDir) {
    const skillsDir = join(installDir, 'skills');
    if (!isDir(skillsDir))
        return { names: [], listingTokens: 0 };
    const names = [];
    let listingTokens = 0;
    for (const entry of safeReaddir(skillsDir)) {
        const skillDir = join(skillsDir, entry);
        if (!isDir(skillDir))
            continue;
        const upper = join(skillDir, 'SKILL.md');
        const lower = join(skillDir, 'skill.md');
        const present = isFile(upper) ? upper : isFile(lower) ? lower : null;
        if (present === null)
            continue;
        names.push(entry);
        let content = '';
        try {
            content = readFileSync(present, 'utf-8');
        }
        catch { /* unreadable */ }
        listingTokens += content
            ? listingTokensFromContent(entry, content)
            : SKILL_PROMPT_OVERHEAD_TOKENS;
    }
    return { names, listingTokens };
}
function scanCommands(installDir) {
    const commandsDir = join(installDir, 'commands');
    if (!isDir(commandsDir))
        return [];
    const names = [];
    for (const entry of safeReaddir(commandsDir)) {
        if (entry.endsWith('.md') && isFile(join(commandsDir, entry))) {
            names.push(entry.slice(0, -3)); // strip .md
        }
    }
    return names;
}
function countFiles(dir) {
    if (!isDir(dir))
        return 0;
    let count = 0;
    for (const entry of safeReaddir(dir)) {
        if (isFile(join(dir, entry)))
            count++;
    }
    return count;
}
export function scanPluginSurfaces() {
    const pluginsDir = getPluginsDir();
    const results = [];
    for (const marketplace of safeReaddir(pluginsDir)) {
        const marketplaceDir = join(pluginsDir, marketplace);
        if (!isDir(marketplaceDir))
            continue;
        for (const pluginName of safeReaddir(marketplaceDir)) {
            const pluginBaseDir = join(marketplaceDir, pluginName);
            if (!isDir(pluginBaseDir))
                continue;
            // A plugin may have several version subdirectories, but a session loads
            // exactly one. Emitting a surface per version made every per-plugin cost
            // a multiple of the truth, because computePluginCosts sums across
            // surfaces while computePluginBreakdown picks a single one — the two
            // disagreed, and the summed figure is what reached the user.
            const versions = safeReaddir(pluginBaseDir)
                .map((version) => ({ version, installDir: join(pluginBaseDir, version) }))
                .filter((v) => isDir(v.installDir))
                .map((v) => {
                const dirStat = safeStat(v.installDir);
                return { ...v, installedAt: dirStat ? Number(dirStat.mtimeMs) : 0 };
            });
            const active = pickActiveVersion(versions);
            if (active) {
                const { version, installDir, installedAt } = active;
                const { names: skills, listingTokens: skillListingTokens } = scanSkills(installDir);
                const mcpServerKeys = parseMcpServerKeys(installDir);
                const mcpToolPrefixes = mcpServerKeys.map((key) => `plugin_${pluginName}_${key}`);
                const commands = scanCommands(installDir);
                const agentCount = countFiles(join(installDir, 'agents'));
                const hookCount = countFiles(join(installDir, 'hooks'));
                results.push({
                    pluginName,
                    marketplace,
                    version,
                    installDir,
                    installedAt,
                    skills,
                    skillListingTokens,
                    mcpServerKeys,
                    mcpToolPrefixes,
                    commands,
                    agentCount,
                    hookCount,
                });
            }
        }
    }
    return results;
}
