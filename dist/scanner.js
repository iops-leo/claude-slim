import { readdir, readFile, readlink, stat, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { countTokensCached } from './tokenizer.js';
import { getClaudeDir, getSkillsDir, getPluginsDir, getProjectsDir } from './paths.js';
const STALE_DAYS = 90;
async function safeReadFile(p) {
    try {
        return await readFile(p, 'utf-8');
    }
    catch {
        return null;
    }
}
async function safeReaddir(p) {
    try {
        return await readdir(p);
    }
    catch {
        return [];
    }
}
async function isDirectory(p) {
    try {
        return (await stat(p)).isDirectory();
    }
    catch {
        return false;
    }
}
async function isBrokenSymlink(p) {
    try {
        const lstats = await lstat(p);
        if (!lstats.isSymbolicLink())
            return false;
        await realpath(p);
        return false;
    }
    catch {
        try {
            return (await lstat(p)).isSymbolicLink();
        }
        catch {
            return false;
        }
    }
}
async function runCommand(cmd) {
    try {
        const { exec } = await import('node:child_process');
        return new Promise((resolve) => {
            exec(cmd, { timeout: 10000 }, (_err, stdout) => {
                resolve(stdout || '');
            });
        });
    }
    catch {
        return '';
    }
}
async function getDirSize(dir) {
    let total = 0;
    const entries = await safeReaddir(dir);
    for (const entry of entries) {
        const p = join(dir, entry);
        try {
            const s = await stat(p);
            if (s.isFile())
                total += s.size;
            else if (s.isDirectory())
                total += await getDirSize(p);
        }
        catch { /* skip */ }
    }
    return total;
}
// Content cache: avoids re-reading files during classification
const contentCache = new Map();
async function resolveRealPath(p) {
    try {
        return await realpath(p);
    }
    catch {
        return p;
    }
}
export function dedupeBySymlink(candidates) {
    const seen = new Map();
    for (const { skill, realMdPath } of candidates) {
        const existing = seen.get(realMdPath);
        if (!existing) {
            seen.set(realMdPath, skill);
            continue;
        }
        // Prefer top-level name (no slash) over nested duplicate
        const existingIsNested = existing.name.includes('/');
        const currentIsNested = skill.name.includes('/');
        if (existingIsNested && !currentIsNested) {
            seen.set(realMdPath, skill);
        }
    }
    return Array.from(seen.values());
}
async function scanLocalSkills() {
    const skillsDir = getSkillsDir();
    const candidates = [];
    const brokenSymlinks = [];
    const entries = await safeReaddir(skillsDir);
    const scanPromises = entries.map(async (entry) => {
        const dirPath = join(skillsDir, entry);
        if (!(await isDirectory(dirPath)))
            return;
        const skillMd = join(dirPath, 'SKILL.md');
        if (await isBrokenSymlink(skillMd)) {
            let target = 'unknown';
            try {
                target = await readlink(skillMd);
            }
            catch { /* */ }
            brokenSymlinks.push({ name: entry, path: skillMd, target });
            return;
        }
        const content = await safeReadFile(skillMd);
        if (content !== null) {
            contentCache.set(skillMd, content);
            const tokens = countTokensCached(content, skillMd);
            const realMdPath = await resolveRealPath(skillMd);
            candidates.push({
                skill: {
                    name: entry,
                    path: dirPath,
                    sizeBytes: Buffer.byteLength(content),
                    tokens,
                    source: 'local',
                },
                realMdPath,
            });
        }
        // Nested skills (e.g., @internal-sys/commit-guide)
        const subEntries = await safeReaddir(dirPath);
        for (const sub of subEntries) {
            const subDir = join(dirPath, sub);
            if (!(await isDirectory(subDir)))
                continue;
            const subSkillMd = join(subDir, 'SKILL.md');
            if (await isBrokenSymlink(subSkillMd)) {
                let target = 'unknown';
                try {
                    target = await readlink(subSkillMd);
                }
                catch { /* */ }
                brokenSymlinks.push({ name: `${entry}/${sub}`, path: subSkillMd, target });
                continue;
            }
            const subContent = await safeReadFile(subSkillMd);
            if (subContent !== null) {
                const name = `${entry}/${sub}`;
                contentCache.set(subSkillMd, subContent);
                const tokens = countTokensCached(subContent, subSkillMd);
                const realMdPath = await resolveRealPath(subSkillMd);
                candidates.push({
                    skill: {
                        name,
                        path: subDir,
                        sizeBytes: Buffer.byteLength(subContent),
                        tokens,
                        source: 'local',
                    },
                    realMdPath,
                });
            }
        }
    });
    await Promise.all(scanPromises);
    const skills = dedupeBySymlink(candidates);
    return { skills, brokenSymlinks };
}
async function scanPluginSkills() {
    const skills = [];
    const plugins = [];
    const tempCaches = [];
    const pluginsDir = getPluginsDir();
    const pluginDirs = await safeReaddir(pluginsDir);
    const scanPromises = pluginDirs.map(async (pluginName) => {
        const pluginDir = join(pluginsDir, pluginName);
        if (!(await isDirectory(pluginDir)))
            return;
        // Detect temp_local_* cache dirs (failed plugin installs)
        if (pluginName.startsWith('temp_local_')) {
            const size = await getDirSize(pluginDir);
            tempCaches.push({ name: pluginName, path: pluginDir, sizeKB: Math.round(size / 1024) });
            return;
        }
        const pluginSkillNames = [];
        const walkDir = async (dir) => {
            const entries = await safeReaddir(dir);
            for (const entry of entries) {
                const entryPath = join(dir, entry);
                if (!(await isDirectory(entryPath)))
                    continue;
                if (entry === 'skills') {
                    const skillDirs = await safeReaddir(entryPath);
                    for (const skillDir of skillDirs) {
                        const skillPath = join(entryPath, skillDir);
                        if (!(await isDirectory(skillPath)))
                            continue;
                        const skillMd = join(skillPath, 'SKILL.md');
                        const content = await safeReadFile(skillMd);
                        if (content !== null) {
                            pluginSkillNames.push(skillDir);
                            skills.push({
                                name: skillDir,
                                path: skillPath,
                                sizeBytes: Buffer.byteLength(content),
                                tokens: countTokensCached(content, skillMd),
                                source: 'plugin',
                                pluginName,
                            });
                        }
                    }
                }
                else {
                    await walkDir(entryPath);
                }
            }
        };
        await walkDir(pluginDir);
        if (pluginSkillNames.length > 0) {
            plugins.push({
                name: pluginName,
                skillCount: pluginSkillNames.length,
                skills: pluginSkillNames,
            });
        }
    });
    await Promise.all(scanPromises);
    return { skills, plugins, tempCaches };
}
async function scanMemoryFiles() {
    const memoryFiles = [];
    const staleProjects = [];
    const projectsDir = getProjectsDir();
    const projectDirs = await safeReaddir(projectsDir);
    const now = Date.now();
    const scanPromises = projectDirs.map(async (project) => {
        const memDir = join(projectsDir, project, 'memory');
        const files = await safeReaddir(memDir);
        const mdFiles = files.filter((f) => f.endsWith('.md'));
        let newestMtime = 0;
        let totalBytes = 0;
        for (const file of mdFiles) {
            const filePath = join(memDir, file);
            const content = await safeReadFile(filePath);
            if (content !== null) {
                const sizeBytes = Buffer.byteLength(content);
                memoryFiles.push({
                    project,
                    name: file,
                    path: filePath,
                    sizeBytes,
                    tokens: countTokensCached(content, filePath),
                });
                totalBytes += sizeBytes;
                try {
                    const s = await stat(filePath);
                    if (s.mtimeMs > newestMtime)
                        newestMtime = s.mtimeMs;
                }
                catch { /* skip */ }
            }
        }
        // Check for stale project (no files modified in 90+ days)
        if (mdFiles.length > 0 && newestMtime > 0) {
            const ageDays = Math.floor((now - newestMtime) / (1000 * 60 * 60 * 24));
            if (ageDays > STALE_DAYS) {
                staleProjects.push({ project, path: memDir, ageDays, fileCount: mdFiles.length, totalBytes });
            }
        }
    });
    await Promise.all(scanPromises);
    return { memoryFiles, staleProjects };
}
async function getDisabledPlugins() {
    const output = await runCommand('claude plugin list');
    if (!output)
        return new Set();
    const disabled = new Set();
    let currentName = null;
    for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('\u276f')) {
            const full = trimmed.split('\u276f')[1]?.trim() || '';
            // Format: sub-plugin@marketplace — extract marketplace name for cache dir matching
            currentName = full.includes('@') ? full.split('@')[1] : full;
        }
        else if (trimmed.toLowerCase().includes('disabled') && currentName) {
            disabled.add(currentName);
            currentName = null;
        }
        else if (trimmed.toLowerCase().includes('enabled')) {
            currentName = null;
        }
    }
    return disabled;
}
export function parseClaudeMdSections(content) {
    const sections = [];
    const lines = content.split('\n');
    let currentName = null;
    let currentContent = '';
    for (const line of lines) {
        if (line.startsWith('# ')) {
            if (currentName !== null) {
                sections.push({
                    name: currentName,
                    sizeBytes: Buffer.byteLength(currentContent),
                    tokens: countTokensCached(currentContent, `claude-md-section:${currentName}`),
                });
            }
            else if (currentContent.trim()) {
                sections.push({
                    name: '(preamble)',
                    sizeBytes: Buffer.byteLength(currentContent),
                    tokens: countTokensCached(currentContent, 'claude-md-section:preamble'),
                });
            }
            currentName = line.slice(2).trim().slice(0, 60);
            currentContent = line + '\n';
        }
        else {
            currentContent += line + '\n';
        }
    }
    if (currentName !== null) {
        sections.push({
            name: currentName,
            sizeBytes: Buffer.byteLength(currentContent),
            tokens: countTokensCached(currentContent, `claude-md-section:${currentName}`),
        });
    }
    else if (currentContent.trim()) {
        sections.push({
            name: '(preamble)',
            sizeBytes: Buffer.byteLength(currentContent),
            tokens: countTokensCached(currentContent, 'claude-md-section:preamble'),
        });
    }
    return sections;
}
async function scanMcpServers() {
    const content = await safeReadFile(join(getClaudeDir(), 'settings.json'));
    if (!content)
        return { count: 0, names: [] };
    try {
        const data = JSON.parse(content);
        const servers = data.mcpServers || {};
        const names = Object.keys(servers).sort();
        return { count: names.length, names };
    }
    catch {
        return { count: 0, names: [] };
    }
}
function classifyIssues(localSkills, pluginSkills, brokenSymlinks, memoryFiles, tempCaches, staleProjects, disabledPlugins, plugins) {
    const issues = [];
    const pluginSkillNames = new Set(pluginSkills.map((s) => s.name));
    // Tier 1: broken symlinks
    for (const link of brokenSymlinks) {
        issues.push({
            type: 'broken_symlink',
            tier: 1,
            name: link.name,
            detail: link.target,
            tokens: 0,
            path: link.path,
        });
    }
    for (const skill of localSkills) {
        const skillMdPath = join(skill.path, 'SKILL.md');
        // Tier 1: template skills (use cached content instead of re-reading)
        const content = contentCache.get(skillMdPath);
        if (content && content.includes('Replace with description')) {
            issues.push({
                type: 'template',
                tier: 1,
                name: skill.name,
                tokens: skill.tokens,
                path: skill.path,
            });
        }
        // Tier 2: duplicates (local + plugin) — check base name for nested skills
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
        // Tier 3: oversized skills (>10KB)
        if (skill.sizeBytes > 10240) {
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
    // Tier 1: .skill/ duplicate directories
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
    // Tier 1: temp_local_* cache directories
    for (const temp of tempCaches) {
        issues.push({
            type: 'temp_cache',
            tier: 1,
            name: temp.name,
            detail: `${temp.sizeKB}KB`,
            tokens: 0,
            path: temp.path,
        });
    }
    // Tier 2: oversized memory files (>5KB)
    for (const mem of memoryFiles) {
        if (mem.sizeBytes > 5120) {
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
    // Tier 2: stale project memory (90+ days inactive)
    for (const stale of staleProjects) {
        const memTokens = memoryFiles
            .filter((m) => m.project === stale.project)
            .reduce((sum, m) => sum + m.tokens, 0);
        issues.push({
            type: 'stale_project',
            tier: 2,
            name: stale.project,
            detail: `${stale.ageDays}d, ${stale.fileCount} files, ${Math.round(stale.totalBytes / 1024)}KB`,
            tokens: memTokens,
            path: stale.path,
        });
    }
    // Tier 2: disabled plugins still occupying cache
    for (const plugin of plugins) {
        if (disabledPlugins.has(plugin.name)) {
            issues.push({
                type: 'disabled_plugin',
                tier: 2,
                name: plugin.name,
                detail: `${plugin.skillCount} skills`,
                tokens: plugin.skillCount * 30,
                path: join(getPluginsDir(), plugin.name),
            });
        }
    }
    // Sort by tier
    issues.sort((a, b) => a.tier - b.tier);
    return issues;
}
export async function scan() {
    const [{ skills: localSkills, brokenSymlinks }, { skills: pluginSkills, plugins, tempCaches }, { memoryFiles, staleProjects }, mcp, disabledPlugins,] = await Promise.all([
        scanLocalSkills(),
        scanPluginSkills(),
        scanMemoryFiles(),
        scanMcpServers(),
        getDisabledPlugins(),
    ]);
    // Annotate plugin status
    for (const plugin of plugins) {
        plugin.status = disabledPlugins.has(plugin.name) ? 'disabled' : 'enabled';
    }
    // CLAUDE.md
    const claudeMdContent = await safeReadFile(join(getClaudeDir(), 'CLAUDE.md'));
    const claudeMdBytes = claudeMdContent ? Buffer.byteLength(claudeMdContent) : 0;
    const claudeMdTokens = claudeMdContent
        ? countTokensCached(claudeMdContent, join(getClaudeDir(), 'CLAUDE.md'))
        : 0;
    const claudeMdSections = claudeMdContent ? parseClaudeMdSections(claudeMdContent) : [];
    const issues = classifyIssues(localSkills, pluginSkills, brokenSymlinks, memoryFiles, tempCaches, staleProjects, disabledPlugins, plugins);
    // Estimate total tokens at startup
    const skillListingTokens = (localSkills.length + pluginSkills.length) * 30;
    const memoryTokens = memoryFiles.reduce((sum, m) => sum + m.tokens, 0);
    const totalTokensBefore = skillListingTokens + claudeMdTokens + memoryTokens;
    return {
        localSkills,
        pluginSkills,
        plugins,
        brokenSymlinks,
        memoryFiles,
        claudeMdBytes,
        claudeMdTokens,
        claudeMdSections,
        mcpServers: mcp.count,
        mcpServerNames: mcp.names,
        issues,
        totalTokensBefore,
    };
}
