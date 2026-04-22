import { readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { countTokensCached } from '../tokenizer.js';
import { getSkillsDir } from '../paths.js';
import type { SkillInfo, BrokenSymlink } from '../types.js';
import {
  safeReadFile, safeReaddir, isDirectory, isBrokenSymlink, resolveRealPath,
} from './fs-walk.js';

export interface SkillCandidate {
  skill: SkillInfo;
  realMdPath: string;
}

export function dedupeBySymlink(candidates: SkillCandidate[]): SkillInfo[] {
  const seen = new Map<string, SkillInfo>();
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

export interface LocalSkillsResult {
  skills: SkillInfo[];
  brokenSymlinks: BrokenSymlink[];
  contents: Map<string, string>;
}

export async function scanLocalSkills(): Promise<LocalSkillsResult> {
  const skillsDir = getSkillsDir();
  const candidates: SkillCandidate[] = [];
  const brokenSymlinks: BrokenSymlink[] = [];
  const contents = new Map<string, string>();

  const entries = await safeReaddir(skillsDir);

  const scanPromises = entries.map(async (entry) => {
    const dirPath = join(skillsDir, entry);
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
      contents.set(skillMd, content);
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
      if (!(await isDirectory(subDir))) continue;

      const subSkillMd = join(subDir, 'SKILL.md');

      if (await isBrokenSymlink(subSkillMd)) {
        let target = 'unknown';
        try { target = await readlink(subSkillMd); } catch { /* */ }
        brokenSymlinks.push({ name: `${entry}/${sub}`, path: subSkillMd, target });
        continue;
      }

      const subContent = await safeReadFile(subSkillMd);
      if (subContent !== null) {
        const name = `${entry}/${sub}`;
        contents.set(subSkillMd, subContent);
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
  return { skills, brokenSymlinks, contents };
}
