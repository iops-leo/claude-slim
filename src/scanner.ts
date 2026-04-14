import { readdir, readFile, readlink, stat, lstat, access, realpath } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { countTokensCached } from './tokenizer.js';
import type {
  ScanResult, SkillInfo, BrokenSymlink, MemoryFile, PluginInfo, Issue,
} from './types.js';

const HOME = homedir();
const CLAUDE_DIR = join(HOME, '.claude');
const SKILLS_DIR = join(CLAUDE_DIR, 'skills');
const PLUGINS_DIR = join(CLAUDE_DIR, 'plugins', 'cache');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function safeReadFile(p: string): Promise<string | null> {
  try { return await readFile(p, 'utf-8'); } catch { return null; }
}

async function safeReaddir(p: string): Promise<string[]> {
  try { return await readdir(p); } catch { return []; }
}

async function isDirectory(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

async function isBrokenSymlink(p: string): Promise<boolean> {
  try {
    const lstats = await lstat(p);
    if (!lstats.isSymbolicLink()) return false;
    await realpath(p);
    return false;
  } catch {
    try {
      return (await lstat(p)).isSymbolicLink();
    } catch {
      return false;
    }
  }
}

async function scanLocalSkills(): Promise<{ skills: SkillInfo[]; brokenSymlinks: BrokenSymlink[] }> {
  const skills: SkillInfo[] = [];
  const brokenSymlinks: BrokenSymlink[] = [];

  const entries = await safeReaddir(SKILLS_DIR);

  const scanPromises = entries.map(async (entry) => {
    const dirPath = join(SKILLS_DIR, entry);
    if (!(await isDirectory(dirPath))) return;

    const skillMd = join(dirPath, 'SKILL.md');

    if (await isBrokenSymlink(skillMd)) {
      let target = 'unknown';
      try { target = await readlink(skillMd); } catch { /* */ }
      brokenSymlinks.push({ name: entry, path: skillMd, target });
      return;
    }

    const content = await safeReadFile(skillMd);
    if (content !== null) {
      const tokens = countTokensCached(content, skillMd);
      skills.push({
        name: entry,
        path: dirPath,
        sizeBytes: Buffer.byteLength(content),
        tokens,
        source: 'local',
      });
    }

    // Nested skills (e.g., @internal-sys/commit-guide)
    const subEntries = await safeReaddir(dirPath);
    for (const sub of subEntries) {
      const subDir = join(dirPath, sub);
      if (!(await isDirectory(subDir))) continue;
      const subSkillMd = join(subDir, 'SKILL.md');
      const subContent = await safeReadFile(subSkillMd);
      if (subContent !== null) {
        const name = `${entry}/${sub}`;
        const tokens = countTokensCached(subContent, subSkillMd);
        skills.push({
          name,
          path: subDir,
          sizeBytes: Buffer.byteLength(subContent),
          tokens,
          source: 'local',
        });
      }
    }
  });

  await Promise.all(scanPromises);
  return { skills, brokenSymlinks };
}

async function scanPluginSkills(): Promise<{ skills: SkillInfo[]; plugins: PluginInfo[] }> {
  const skills: SkillInfo[] = [];
  const plugins: PluginInfo[] = [];

  const pluginDirs = await safeReaddir(PLUGINS_DIR);

  const scanPromises = pluginDirs.map(async (pluginName) => {
    const pluginDir = join(PLUGINS_DIR, pluginName);
    if (!(await isDirectory(pluginDir))) return;

    const pluginSkillNames: string[] = [];

    // Walk version subdirectories
    const walkDir = async (dir: string): Promise<void> => {
      const entries = await safeReaddir(dir);
      for (const entry of entries) {
        const entryPath = join(dir, entry);
        if (!(await isDirectory(entryPath))) continue;

        if (entry === 'skills') {
          const skillDirs = await safeReaddir(entryPath);
          for (const skillDir of skillDirs) {
            const skillPath = join(entryPath, skillDir);
            if (!(await isDirectory(skillPath))) continue;
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
        } else {
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
  return { skills, plugins };
}

async function scanMemoryFiles(): Promise<MemoryFile[]> {
  const memoryFiles: MemoryFile[] = [];

  const projectDirs = await safeReaddir(PROJECTS_DIR);

  const scanPromises = projectDirs.map(async (project) => {
    const memDir = join(PROJECTS_DIR, project, 'memory');
    const files = await safeReaddir(memDir);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = join(memDir, file);
      const content = await safeReadFile(filePath);
      if (content !== null) {
        memoryFiles.push({
          project,
          name: file,
          path: filePath,
          sizeBytes: Buffer.byteLength(content),
          tokens: countTokensCached(content, filePath),
        });
      }
    }
  });

  await Promise.all(scanPromises);
  return memoryFiles;
}

async function countMcpServers(): Promise<number> {
  const content = await safeReadFile(join(CLAUDE_DIR, 'settings.json'));
  if (!content) return 0;
  try {
    const data = JSON.parse(content);
    return Object.keys(data.mcpServers || {}).length;
  } catch {
    return 0;
  }
}

function classifyIssues(
  localSkills: SkillInfo[],
  pluginSkills: SkillInfo[],
  brokenSymlinks: BrokenSymlink[],
  memoryFiles: MemoryFile[],
): Issue[] {
  const issues: Issue[] = [];
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

    // Tier 1: template skills
    const content = safeReadFileSync(skillMdPath);
    if (content && content.includes('Replace with description')) {
      issues.push({
        type: 'template',
        tier: 1,
        name: skill.name,
        tokens: skill.tokens,
        path: skill.path,
      });
    }

    // Tier 2: duplicates (local + plugin)
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
  // (Check if foo.skill/ exists alongside foo/)
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

  // Sort by tier
  issues.sort((a, b) => a.tier - b.tier);
  return issues;
}

// Sync read for classification (files are already cached in memory by scanner)
function safeReadFileSync(p: string): string | null {
  try {
    const { readFileSync } = require('node:fs');
    return readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

export async function scan(): Promise<ScanResult> {
  const [
    { skills: localSkills, brokenSymlinks },
    { skills: pluginSkills, plugins },
    memoryFiles,
    mcpServers,
  ] = await Promise.all([
    scanLocalSkills(),
    scanPluginSkills(),
    scanMemoryFiles(),
    countMcpServers(),
  ]);

  // CLAUDE.md
  const claudeMdContent = await safeReadFile(join(CLAUDE_DIR, 'CLAUDE.md'));
  const claudeMdBytes = claudeMdContent ? Buffer.byteLength(claudeMdContent) : 0;
  const claudeMdTokens = claudeMdContent
    ? countTokensCached(claudeMdContent, join(CLAUDE_DIR, 'CLAUDE.md'))
    : 0;

  const issues = classifyIssues(localSkills, pluginSkills, brokenSymlinks, memoryFiles);

  // Estimate total tokens at startup
  // Skills load as listings (name + description ~30 tokens each)
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
    mcpServers,
    issues,
    totalTokensBefore,
  };
}
