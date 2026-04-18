import { rename, readdir, rmdir, rm, unlink, lstat, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { appendManifest, ensureDisabledDir, getDisabledDir } from './manifest.js';
import { getSkillsDir } from './paths.js';
async function pathExists(p) {
    try {
        await lstat(p);
        return true;
    }
    catch {
        return false;
    }
}
export async function cleanIssues(issues) {
    await ensureDisabledDir();
    const disabledDir = getDisabledDir();
    const moved = [];
    const skipped = [];
    const errors = [];
    for (const issue of issues) {
        try {
            if (issue.type === 'broken_symlink') {
                await unlink(issue.path);
                const entry = {
                    date: new Date().toISOString(),
                    name: issue.name,
                    from: issue.path,
                    type: issue.type,
                    tokenCount: issue.tokens,
                    tier: issue.tier,
                };
                await appendManifest(entry);
                moved.push(entry);
            }
            else if (issue.type === 'template' ||
                issue.type === 'duplicate' ||
                issue.type === 'skill_dup' ||
                issue.type === 'oversized_skill') {
                // Move skill directory to disabled — use name (not basename) to avoid namespace collisions
                const safeName = issue.name.replace(/\//g, '--');
                const dest = join(disabledDir, safeName);
                await rename(issue.path, dest);
                const entry = {
                    date: new Date().toISOString(),
                    name: issue.name,
                    from: issue.path,
                    type: issue.type,
                    tokenCount: issue.tokens,
                    tier: issue.tier,
                };
                await appendManifest(entry);
                moved.push(entry);
            }
            else if (issue.type === 'temp_cache') {
                // Delete temp directories (failed plugin installs, not restorable)
                await rm(issue.path, { recursive: true, force: true });
                const entry = {
                    date: new Date().toISOString(),
                    name: issue.name,
                    from: issue.path,
                    type: issue.type,
                    tokenCount: 0,
                    tier: issue.tier,
                };
                await appendManifest(entry);
                moved.push(entry);
            }
            else if (issue.type === 'stale_project') {
                const backupParent = join(disabledDir, 'memory-backup');
                await mkdir(backupParent, { recursive: true });
                const backupDir = join(backupParent, issue.name);
                // Refuse to overwrite an existing backup — protects prior clean state
                if (await pathExists(backupDir)) {
                    throw new Error(`Backup already exists for "${issue.name}" at ${backupDir}. ` +
                        `Restore or remove it before cleaning again.`);
                }
                // Atomic directory rename — requires same FS (guaranteed since both paths are under ~/.claude/)
                await rename(issue.path, backupDir);
                const entry = {
                    date: new Date().toISOString(),
                    name: issue.name,
                    from: issue.path,
                    type: issue.type,
                    tokenCount: issue.tokens,
                    tier: issue.tier,
                };
                await appendManifest(entry);
                moved.push(entry);
            }
            else if (issue.type === 'oversized_memory' || issue.type === 'disabled_plugin') {
                // Report only — user manages these manually
                skipped.push(issue.name);
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            errors.push({ name: issue.name, error: message });
        }
    }
    // Clean empty directories in skills/
    await cleanEmptyDirs(getSkillsDir());
    return { moved, skipped, errors };
}
async function cleanEmptyDirs(dir) {
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
            }
            catch { /* skip */ }
        }
    }
    catch { /* skip */ }
}
export async function restoreItem(entry) {
    if (entry.type === 'broken_symlink') {
        throw new Error(`Broken symlinks cannot be restored (${entry.name})`);
    }
    if (entry.type === 'disabled_plugin') {
        throw new Error(`Plugins must be reinstalled: claude plugin install ${entry.name}`);
    }
    if (entry.type === 'temp_cache') {
        throw new Error(`Temp caches were deleted and cannot be restored (${entry.name})`);
    }
    const disabledDir = getDisabledDir();
    if (entry.type === 'stale_project') {
        const backupDir = join(disabledDir, 'memory-backup', entry.name);
        // Refuse to overwrite user's current state
        if (await pathExists(entry.from)) {
            throw new Error(`Cannot restore: ${entry.from} already exists. ` +
                `Remove or rename it first.`);
        }
        await mkdir(dirname(entry.from), { recursive: true });
        // Atomic directory rename — requires same FS (guaranteed since both paths are under ~/.claude/)
        await rename(backupDir, entry.from);
    }
    else {
        // Restore skill directory using the same naming as cleanIssues
        const safeName = entry.name.replace(/\//g, '--');
        const src = join(disabledDir, safeName);
        await mkdir(dirname(entry.from), { recursive: true });
        await rename(src, entry.from);
    }
    const restoreEntry = {
        date: new Date().toISOString(),
        name: entry.name,
        from: entry.from,
        type: entry.type,
        action: 'restored',
    };
    await appendManifest(restoreEntry);
}
