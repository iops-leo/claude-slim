import { join } from 'node:path';
import { countTokensCached } from '../tokenizer.js';
import { getPluginsDir } from '../paths.js';
import type { SkillInfo, PluginInfo } from '../types.js';
import { safeReadFile, safeReaddir, isDirectory, getDirSize } from './fs-walk.js';
import { listingTokensFromContent } from './skill-listing.js';

export interface TempCache {
  name: string;
  path: string;
  sizeKB: number;
}

export interface PluginSkillsResult {
  skills: SkillInfo[];
  plugins: PluginInfo[];
  tempCaches: TempCache[];
}

export async function scanPluginSkills(): Promise<PluginSkillsResult> {
  const skills: SkillInfo[] = [];
  const plugins: PluginInfo[] = [];
  const tempCaches: TempCache[] = [];

  const pluginsDir = getPluginsDir();
  const pluginDirs = await safeReaddir(pluginsDir);

  const scanPromises = pluginDirs.map(async (pluginName) => {
    const pluginDir = join(pluginsDir, pluginName);
    if (!(await isDirectory(pluginDir))) return;

    // Detect temp_local_* cache dirs (failed plugin installs)
    if (pluginName.startsWith('temp_local_')) {
      const size = await getDirSize(pluginDir);
      tempCaches.push({ name: pluginName, path: pluginDir, sizeKB: Math.round(size / 1024) });
      return;
    }

    const pluginSkillNames: string[] = [];

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
                listingTokens: listingTokensFromContent(skillDir, content),
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
  return { skills, plugins, tempCaches };
}
