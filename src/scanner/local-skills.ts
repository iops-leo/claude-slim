import { readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { countTokensCached } from '../tokenizer.js';
import { getSkillsDir } from '../paths.js';
import type { SkillInfo, BrokenSymlink } from '../types.js';
import {
  safeReadFile, safeReaddir, isDirectory, isBrokenSymlink, resolveRealPath,
} from './fs-walk.js';
import { listingTokensFromContent } from './skill-listing.js';

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

// Max depth for the nested-skill walk. Depth 1 = ~/.claude/skills/<a>/SKILL.md,
// depth 2 = ~/.claude/skills/<a>/<b>/SKILL.md, etc. Depth 3 covers the deepest
// layouts seen in the wild (e.g. plugin-namespaced groups like
// skills/<org>/<group>/<skill>/SKILL.md) while keeping the walk finite.
// If a directory contains a SKILL.md we stop descending — nested SKILL.md
// files under an already-declared skill would just create phantom duplicates.
const MAX_SKILL_DEPTH = 3;

export async function scanLocalSkills(): Promise<LocalSkillsResult> {
  const skillsDir = getSkillsDir();
  const candidates: SkillCandidate[] = [];
  const brokenSymlinks: BrokenSymlink[] = [];
  const contents = new Map<string, string>();

  async function visit(dirPath: string, nameParts: string[], depth: number): Promise<void> {
    if (depth > MAX_SKILL_DEPTH) return;

    const skillMd = join(dirPath, 'SKILL.md');
    const displayName = nameParts.join('/');

    if (await isBrokenSymlink(skillMd)) {
      let target = 'unknown';
      try { target = await readlink(skillMd); } catch { /* */ }
      brokenSymlinks.push({ name: displayName, path: skillMd, target });
      return;
    }

    const content = await safeReadFile(skillMd);
    if (content !== null) {
      contents.set(skillMd, content);
      const tokens = countTokensCached(content, skillMd);
      const realMdPath = await resolveRealPath(skillMd);
      candidates.push({
        skill: {
          name: displayName,
          path: dirPath,
          sizeBytes: Buffer.byteLength(content),
          tokens,
          listingTokens: listingTokensFromContent(displayName, content),
          source: 'local',
        },
        realMdPath,
      });
      // Stop descending: nested SKILL.md files under a declared skill are
      // documentation/examples, not addressable skills.
      return;
    }

    if (depth === MAX_SKILL_DEPTH) return;

    const subEntries = await safeReaddir(dirPath);
    await Promise.all(
      subEntries.map(async (sub) => {
        const subDir = join(dirPath, sub);
        // isDirectory() uses stat(), which follows symlinks — intentional so
        // users can symlink shared skills into ~/.claude/skills/. A cycle
        // through symlinks would be bounded by MAX_SKILL_DEPTH, not by us
        // detecting the loop directly.
        if (!(await isDirectory(subDir))) return;
        await visit(subDir, [...nameParts, sub], depth + 1);
      }),
    );
  }

  const topEntries = await safeReaddir(skillsDir);
  await Promise.all(
    topEntries.map(async (entry) => {
      const dirPath = join(skillsDir, entry);
      if (!(await isDirectory(dirPath))) return;
      await visit(dirPath, [entry], 1);
    }),
  );

  const skills = dedupeBySymlink(candidates);
  return { skills, brokenSymlinks, contents };
}
