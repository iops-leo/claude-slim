import { join } from 'node:path';
import { statSync } from 'node:fs';
import { readFileSync, readdirSync } from 'node:fs';
import { getPluginsDir } from '../paths.js';
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
        return [];
    const names = [];
    for (const entry of safeReaddir(skillsDir)) {
        const skillDir = join(skillsDir, entry);
        if (!isDir(skillDir))
            continue;
        const upper = join(skillDir, 'SKILL.md');
        const lower = join(skillDir, 'skill.md');
        if (isFile(upper) || isFile(lower)) {
            names.push(entry);
        }
    }
    return names;
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
            // Each plugin may have version subdirectories
            for (const version of safeReaddir(pluginBaseDir)) {
                const installDir = join(pluginBaseDir, version);
                if (!isDir(installDir))
                    continue;
                const dirStat = safeStat(installDir);
                const installedAt = dirStat ? Number(dirStat.mtimeMs) : 0;
                const skills = scanSkills(installDir);
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
