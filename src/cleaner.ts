import { rename, readdir, rmdir, unlink, lstat, realpath } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { appendManifest, ensureDisabledDir, getDisabledDir } from './manifest.js';
import type { Issue, ManifestEntry } from './types.js';

const SKILLS_DIR = join(homedir(), '.claude', 'skills');

export interface CleanResult {
  moved: ManifestEntry[];
  skipped: string[];
  errors: Array<{ name: string; error: string }>;
}

export async function cleanIssues(issues: Issue[]): Promise<CleanResult> {
  await ensureDisabledDir();
  const disabledDir = getDisabledDir();

  const moved: ManifestEntry[] = [];
  const skipped: string[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  for (const issue of issues) {
    try {
      if (issue.type === 'broken_symlink') {
        // Delete broken symlink file directly
        await unlink(issue.path);
        const entry: ManifestEntry = {
          date: new Date().toISOString(),
          name: issue.name,
          from: issue.path,
          type: issue.type,
          tokenCount: issue.tokens,
          tier: issue.tier,
        };
        await appendManifest(entry);
        moved.push(entry);
      } else if (
        issue.type === 'template' ||
        issue.type === 'duplicate' ||
        issue.type === 'skill_dup' ||
        issue.type === 'oversized_skill'
      ) {
        // Move skill directory to disabled
        const dest = join(disabledDir, basename(issue.path));
        await rename(issue.path, dest);
        const entry: ManifestEntry = {
          date: new Date().toISOString(),
          name: issue.name,
          from: issue.path,
          type: issue.type,
          tokenCount: issue.tokens,
          tier: issue.tier,
        };
        await appendManifest(entry);
        moved.push(entry);
      } else if (issue.type === 'oversized_memory') {
        // Memory files: skip (report only, user manages manually)
        skipped.push(issue.name);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ name: issue.name, error: message });
    }
  }

  // Clean empty directories in skills/
  await cleanEmptyDirs(SKILLS_DIR);

  return { moved, skipped, errors };
}

async function cleanEmptyDirs(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      try {
        const stats = await lstat(entryPath);
        if (stats.isDirectory()) {
          await cleanEmptyDirs(entryPath);
          const remaining = await readdir(entryPath);
          if (remaining.length === 0) {
            await rmdir(entryPath);
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}

export async function restoreItem(entry: ManifestEntry): Promise<void> {
  if (entry.type === 'broken_symlink') {
    // Broken symlinks were deleted, can't restore
    throw new Error(`Broken symlinks cannot be restored (${entry.name})`);
  }

  const disabledDir = getDisabledDir();
  const src = join(disabledDir, basename(entry.from));
  await rename(src, entry.from);

  const restoreEntry: ManifestEntry = {
    date: new Date().toISOString(),
    name: entry.name,
    from: entry.from,
    type: entry.type,
    action: 'restored',
  };
  await appendManifest(restoreEntry);
}
