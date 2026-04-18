import { dir } from 'tmp-promise';
import { join } from 'node:path';
import { mkdir, writeFile, symlink, access } from 'node:fs/promises';
import { vi } from 'vitest';

export interface TmpClaude {
  home: string;
  claudeDir: string;
  skillsDir: string;
  pluginsDir: string;
  projectsDir: string;
  disabledDir: string;
  cleanup: () => Promise<void>;
}

export async function createTmpClaude(): Promise<TmpClaude> {
  const d = await dir({ unsafeCleanup: true });
  const home = d.path;
  const claudeDir = join(home, '.claude');
  const skillsDir = join(claudeDir, 'skills');
  const pluginsDir = join(claudeDir, 'plugins', 'cache');
  const projectsDir = join(claudeDir, 'projects');
  const disabledDir = join(claudeDir, 'skills.disabled');

  await mkdir(skillsDir, { recursive: true });
  await mkdir(pluginsDir, { recursive: true });
  await mkdir(projectsDir, { recursive: true });

  vi.stubEnv('HOME', home);

  return {
    home,
    claudeDir,
    skillsDir,
    pluginsDir,
    projectsDir,
    disabledDir,
    cleanup: async () => {
      vi.unstubAllEnvs();
      await d.cleanup();
    },
  };
}

export async function writeSkill(
  skillsDir: string,
  name: string,
  content: string,
): Promise<string> {
  const skillDir = join(skillsDir, name);
  await mkdir(skillDir, { recursive: true });
  const mdPath = join(skillDir, 'SKILL.md');
  await writeFile(mdPath, content);
  return skillDir;
}

export async function writeBrokenSymlink(
  skillsDir: string,
  name: string,
): Promise<string> {
  const skillDir = join(skillsDir, name);
  await mkdir(skillDir, { recursive: true });
  const mdPath = join(skillDir, 'SKILL.md');
  await symlink('/nonexistent/target', mdPath);
  return mdPath;
}

export async function writeTempCache(
  pluginsDir: string,
  name: string,
): Promise<string> {
  const cacheDir = join(pluginsDir, name);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(cacheDir, 'junk.txt'), 'failed install remnant');
  return cacheDir;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
