import { join } from 'node:path';
import { countTokensCached } from '../tokenizer.js';
import { getPluginsDir } from '../paths.js';
import type { SkillInfo, PluginInfo } from '../types.js';
import { safeReadFile, safeReaddir, isDirectory, getDirSize, safeStat } from './fs-walk.js';
import { pickActiveVersion } from './plugin-versions.js';
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

/**
 * The directories under a marketplace whose skills a session would load — one
 * per plugin, never two versions of the same one.
 *
 * The cache is laid out `<marketplace>/<plugin>/<version>/`. A plugin whose
 * content sits directly under `<plugin>/` is returned as-is; otherwise its
 * children are versions and only the active one counts. That distinction is
 * drawn by looking for a `skills` directory rather than by pattern-matching
 * version names, so a plugin that ships no skills is simply walked as before
 * and contributes nothing either way.
 */
interface ContentRoot {
  dir: string;
  /** Plugin directory name, or undefined for a cache entry with no plugin level. */
  plugin?: string;
}

async function resolveContentRoots(pluginBaseDir: string): Promise<ContentRoot[]> {
  const entries = await safeReaddir(pluginBaseDir);

  // Flat layout: the cache entry holds content directly, with no plugin or
  // version level (`<cache-entry>/skills/<skill>/`). Without this check the
  // loop below reads `skills` as a plugin directory and each skill inside it as
  // a candidate version, then picks exactly one — which is not a miscount but a
  // silent disappearance: the whole entry reported zero skills.
  if (entries.includes('skills')) return [{ dir: pluginBaseDir }];

  const roots: ContentRoot[] = [];

  for (const entry of entries) {
    const pluginDir = join(pluginBaseDir, entry);
    if (!(await isDirectory(pluginDir))) continue;

    const children = await safeReaddir(pluginDir);
    if (children.includes('skills')) {
      // Content root, not a version container.
      roots.push({ dir: pluginDir, plugin: entry });
      continue;
    }

    const versions = [];
    for (const child of children) {
      const versionDir = join(pluginDir, child);
      if (!(await isDirectory(versionDir))) continue;
      const stats = await safeStat(versionDir);
      versions.push({ version: child, installedAt: stats?.mtimeMs ?? 0, dir: versionDir });
    }

    const active = pickActiveVersion(versions);
    // No subdirectories at all: hand back the plugin dir so the walk behaves
    // exactly as it did before rather than silently dropping the plugin.
    roots.push({ dir: active ? active.dir : pluginDir, plugin: entry });
  }

  // A marketplace with no plugin subdirectories still needs walking — some
  // caches put content directly under the top level.
  return roots.length > 0 ? roots : [{ dir: pluginBaseDir }];
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

    const walkDir = async (dir: string, plugin?: string): Promise<void> => {
      // Kept generic: a plugin's content root is normally
      // `<plugin>/<version>/`, but the walk also has to reach skills nested
      // deeper. Version selection happens before we get here — see
      // resolveContentRoots below — so this only ever descends one install.
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
                plugin,
              });
            }
          }
        } else {
          await walkDir(entryPath, plugin);
        }
      }
    };

    for (const root of await resolveContentRoots(pluginDir)) {
      await walkDir(root.dir, root.plugin);
    }

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
