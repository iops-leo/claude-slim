import { rename, readdir, rmdir, rm, unlink, lstat, mkdir } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';
import { appendManifest, ensureDisabledDir, getDisabledDir, removeEntry, recordDisabledPlugin, removeDisabledPlugin } from './manifest.js';
import { assertInsideClaudeDir, getSkillsDir, getProjectsDir } from './paths.js';
import { disablePlugin, enablePlugin, isClaudeCliAvailable, ClaudeCliMissingError } from './plugin-runtime.js';
import type { Issue, ManifestEntry, DisabledPluginEntry } from './types.js';

// Restrict a restore target to a specific subtree of ~/.claude/. Complements
// assertInsideClaudeDir: a tampered manifest could still name a legal
// ~/.claude/ path that belongs to a different type of asset (e.g. redirect a
// stale-project restore into ~/.claude/skills/ to clobber a skill). By pinning
// each restore type to its own subtree we close that gap.
function assertInsideSubtree(p: string, subtreeRoot: string, label: string): void {
  const resolvedTarget = resolve(p);
  const resolvedRoot = resolve(subtreeRoot);
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(resolvedRoot + sep)
  ) {
    throw new Error(
      `Refusing to restore ${label} outside ${subtreeRoot}: ${p}`,
    );
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

export interface CleanResult {
  moved: ManifestEntry[];
  skipped: string[];
  errors: Array<{ name: string; error: string }>;
  /**
   * Populated when one or more `unused_plugin` items were requested but the
   * `claude` CLI is missing from PATH. The CLI surfaces this once at the top of
   * the error block instead of N repeat rows.
   */
  claudeCliMissing?: boolean;
}

// Record the manifest entry; if it fails, run the caller's compensation to
// undo the filesystem side effect so we never leave an untracked orphan.
async function recordOrRollback(
  entry: ManifestEntry,
  rollback: () => Promise<void>,
): Promise<void> {
  try {
    await appendManifest(entry);
  } catch (err) {
    try { await rollback(); } catch { /* best-effort */ }
    throw err;
  }
}

export async function cleanIssues(issues: Issue[]): Promise<CleanResult> {
  await ensureDisabledDir();
  const disabledDir = getDisabledDir();

  const moved: ManifestEntry[] = [];
  const skipped: string[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  // Pre-check: if any unused_plugin items are selected, verify `claude` CLI is
  // reachable before we start. Failing fast with a single friendly message
  // beats N raw ENOENTs mid-run. Skip the probe if no plugin items were picked.
  const wantsPluginOps = issues.some((i) => i.type === 'unused_plugin');
  let claudeCliMissing = false;
  if (wantsPluginOps && !(await isClaudeCliAvailable())) {
    claudeCliMissing = true;
  }

  for (const issue of issues) {
    try {
      // unused_plugin and report-only types don't touch filesystem paths directly
      if (issue.type !== 'unused_plugin' && issue.type !== 'oversized_memory' && issue.type !== 'disabled_plugin') {
        assertInsideClaudeDir(issue.path);
      }
      if (issue.type === 'broken_symlink') {
        await unlink(issue.path);
        const entry: ManifestEntry = {
          date: new Date().toISOString(),
          name: issue.name,
          from: issue.path,
          type: issue.type,
          tokenCount: issue.tokens,
          tier: issue.tier,
        };
        // unlink is not reversible; best-effort append only
        await appendManifest(entry);
        moved.push(entry);
      } else if (
        issue.type === 'template' ||
        issue.type === 'duplicate' ||
        issue.type === 'skill_dup' ||
        issue.type === 'oversized_skill' ||
        issue.type === 'unused_skill'
      ) {
        // Move skill directory to disabled — use name (not basename) to avoid namespace collisions
        const safeName = issue.name.replace(/\//g, '--');
        const dest = join(disabledDir, safeName);
        await rename(issue.path, dest);
        const entry: ManifestEntry = {
          date: new Date().toISOString(),
          name: issue.name,
          from: issue.path,
          type: issue.type,
          tokenCount: issue.tokens,
          tier: issue.tier,
        };
        await recordOrRollback(entry, () => rename(dest, issue.path));
        moved.push(entry);
      } else if (issue.type === 'temp_cache') {
        // Delete temp directories (failed plugin installs, not restorable).
        // If the path is itself a symlink, only remove the link — never
        // follow it into whatever it points at. fs.rm on Node >=18 already
        // behaves this way, but we encode the invariant explicitly.
        const st = await lstat(issue.path);
        if (st.isSymbolicLink()) {
          await unlink(issue.path);
        } else {
          await rm(issue.path, { recursive: true, force: true });
        }
        const entry: ManifestEntry = {
          date: new Date().toISOString(),
          name: issue.name,
          from: issue.path,
          type: issue.type,
          tokenCount: 0,
          tier: issue.tier,
        };
        // rm is not reversible; best-effort append only
        await appendManifest(entry);
        moved.push(entry);
      } else if (issue.type === 'stale_project') {
        const backupParent = join(disabledDir, 'memory-backup');
        await mkdir(backupParent, { recursive: true });
        const backupDir = join(backupParent, issue.name);
        // Refuse to overwrite an existing backup — protects prior clean state
        if (await pathExists(backupDir)) {
          throw new Error(
            `Backup already exists for "${issue.name}" at ${backupDir}. ` +
            `Restore or remove it before cleaning again.`,
          );
        }
        // Atomic directory rename — requires same FS (guaranteed since both paths are under ~/.claude/)
        await rename(issue.path, backupDir);
        const entry: ManifestEntry = {
          date: new Date().toISOString(),
          name: issue.name,
          from: issue.path,
          type: issue.type,
          tokenCount: issue.tokens,
          tier: issue.tier,
        };
        await recordOrRollback(entry, () => rename(backupDir, issue.path));
        moved.push(entry);
      } else if (issue.type === 'unused_plugin') {
        // Pre-check flagged `claude` missing — skip silently; the CLI prints
        // one grouped message after cleanIssues returns.
        if (claudeCliMissing) {
          skipped.push(issue.name);
          continue;
        }
        await disablePlugin(issue.name);
        // Record in manifest; if that fails, roll back the disable
        try {
          await recordDisabledPlugin(issue.name, issue.marketplace ?? 'unknown');
        } catch (e) {
          await enablePlugin(issue.name).catch(() => {});
          throw e;
        }
        // unused_plugin doesn't contribute to moved (no ManifestEntry shape), track skipped
        skipped.push(issue.name);
      } else if (issue.type === 'oversized_memory' || issue.type === 'disabled_plugin') {
        // Report only — user manages these manually
        skipped.push(issue.name);
      }
    } catch (err) {
      // Race window: `claude` was on PATH at pre-check but gone by the time we
      // shelled out. Convert to the same grouped skip path instead of a raw
      // ENOENT row.
      if (err instanceof ClaudeCliMissingError) {
        claudeCliMissing = true;
        skipped.push(issue.name);
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ name: issue.name, error: message });
    }
  }

  // Clean empty directories in skills/
  await cleanEmptyDirs(getSkillsDir());

  return { moved, skipped, errors, claudeCliMissing };
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

export async function restoreItem(entry: ManifestEntry | DisabledPluginEntry): Promise<void> {
  // Handle new-style disabled_plugin entries (plugin + marketplace shape)
  if ('plugin' in entry && 'marketplace' in entry) {
    const pluginEntry = entry as DisabledPluginEntry;
    await enablePlugin(pluginEntry.plugin);
    await removeDisabledPlugin(pluginEntry.plugin, pluginEntry.marketplace);
    return;
  }

  const legacyEntry = entry as ManifestEntry;
  assertInsideClaudeDir(legacyEntry.from);
  if (legacyEntry.type === 'broken_symlink') {
    throw new Error(`Broken symlinks cannot be restored (${legacyEntry.name})`);
  }
  if (legacyEntry.type === 'disabled_plugin') {
    throw new Error(`Plugins must be reinstalled: claude plugin install ${legacyEntry.name}`);
  }
  if (legacyEntry.type === 'temp_cache') {
    throw new Error(`Temp caches were deleted and cannot be restored (${legacyEntry.name})`);
  }

  const disabledDir = getDisabledDir();

  if (legacyEntry.type === 'stale_project') {
    // Type-scoped path guard: stale-project backups must restore under
    // ~/.claude/projects/. Prevents a tampered manifest from redirecting a
    // restore into ~/.claude/skills/ (or elsewhere under ~/.claude/) and
    // clobbering an unrelated asset.
    assertInsideSubtree(legacyEntry.from, getProjectsDir(), 'project memory');
    const backupDir = join(disabledDir, 'memory-backup', legacyEntry.name);
    // Refuse to overwrite user's current state
    if (await pathExists(legacyEntry.from)) {
      throw new Error(
        `Cannot restore: ${legacyEntry.from} already exists. ` +
        `Remove or rename it first.`,
      );
    }
    await mkdir(dirname(legacyEntry.from), { recursive: true });
    // Atomic directory rename — requires same FS (guaranteed since both paths are under ~/.claude/)
    await rename(backupDir, legacyEntry.from);
  } else {
    // Type-scoped path guard: skill restores must land under ~/.claude/skills/.
    assertInsideSubtree(legacyEntry.from, getSkillsDir(), 'skill');
    // Restore skill directory using the same naming as cleanIssues
    const safeName = legacyEntry.name.replace(/\//g, '--');
    const src = join(disabledDir, safeName);
    if (!(await pathExists(src))) {
      throw new Error(
        `Backup not found for "${legacyEntry.name}" at ${src}. ` +
        `It may have been manually removed.`,
      );
    }
    if (await pathExists(legacyEntry.from)) {
      throw new Error(
        `Cannot restore: ${legacyEntry.from} already exists. ` +
        `Remove or rename it first.`,
      );
    }
    await mkdir(dirname(legacyEntry.from), { recursive: true });
    await rename(src, legacyEntry.from);
  }

  await removeEntry(legacyEntry.name);
}
