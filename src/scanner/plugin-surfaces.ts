import { join } from 'node:path';
import { statSync } from 'node:fs';
import { readFileSync, readdirSync } from 'node:fs';
import { getPluginsDir } from '../paths.js';

export interface PluginSurfaces {
  pluginName: string;
  marketplace: string;
  version: string;
  installDir: string;        // absolute path
  installedAt: number;       // installDir mtime (ms)
  skills: string[];          // skill names (directory names)
  mcpServerKeys: string[];   // mcpServers keys from .mcp.json
  mcpToolPrefixes: string[]; // expected mcp tool prefix: `plugin_<pluginName>_<serverKey>`
  commands: string[];        // commands/*.md basenames (without extension)
  agentCount: number;        // count of agents/*.md
  hookCount: number;         // count of hooks/*.* files
}

function safeReaddir(p: string): string[] {
  try { return readdirSync(p); } catch { return []; }
}

function safeStat(p: string): import('node:fs').Stats | null {
  try { return statSync(p); } catch { return null; }
}

function isDir(p: string): boolean {
  const s = safeStat(p);
  return s != null && s.isDirectory();
}

function isFile(p: string): boolean {
  const s = safeStat(p);
  return s != null && s.isFile();
}

function parseMcpServerKeys(installDir: string): string[] {
  const mcpPath = join(installDir, '.mcp.json');
  if (!isFile(mcpPath)) return [];
  try {
    const raw = readFileSync(mcpPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'mcpServers' in parsed &&
      typeof (parsed as Record<string, unknown>).mcpServers === 'object' &&
      (parsed as Record<string, unknown>).mcpServers !== null
    ) {
      return Object.keys((parsed as { mcpServers: Record<string, unknown> }).mcpServers);
    }
    return [];
  } catch {
    return [];
  }
}

function scanSkills(installDir: string): string[] {
  const skillsDir = join(installDir, 'skills');
  if (!isDir(skillsDir)) return [];
  const names: string[] = [];
  for (const entry of safeReaddir(skillsDir)) {
    const skillDir = join(skillsDir, entry);
    if (!isDir(skillDir)) continue;
    const upper = join(skillDir, 'SKILL.md');
    const lower = join(skillDir, 'skill.md');
    if (isFile(upper) || isFile(lower)) {
      names.push(entry);
    }
  }
  return names;
}

function scanCommands(installDir: string): string[] {
  const commandsDir = join(installDir, 'commands');
  if (!isDir(commandsDir)) return [];
  const names: string[] = [];
  for (const entry of safeReaddir(commandsDir)) {
    if (entry.endsWith('.md') && isFile(join(commandsDir, entry))) {
      names.push(entry.slice(0, -3)); // strip .md
    }
  }
  return names;
}

function countFiles(dir: string): number {
  if (!isDir(dir)) return 0;
  let count = 0;
  for (const entry of safeReaddir(dir)) {
    if (isFile(join(dir, entry))) count++;
  }
  return count;
}

export function scanPluginSurfaces(): PluginSurfaces[] {
  const pluginsDir = getPluginsDir();
  const results: PluginSurfaces[] = [];

  for (const marketplace of safeReaddir(pluginsDir)) {
    const marketplaceDir = join(pluginsDir, marketplace);
    if (!isDir(marketplaceDir)) continue;

    for (const pluginName of safeReaddir(marketplaceDir)) {
      const pluginBaseDir = join(marketplaceDir, pluginName);
      if (!isDir(pluginBaseDir)) continue;

      // Each plugin may have version subdirectories
      for (const version of safeReaddir(pluginBaseDir)) {
        const installDir = join(pluginBaseDir, version);
        if (!isDir(installDir)) continue;

        const dirStat = safeStat(installDir);
        const installedAt = dirStat ? Number(dirStat.mtimeMs) : 0;

        const skills = scanSkills(installDir);
        const mcpServerKeys = parseMcpServerKeys(installDir);
        const mcpToolPrefixes = mcpServerKeys.map(
          (key) => `plugin_${pluginName}_${key}`,
        );
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
