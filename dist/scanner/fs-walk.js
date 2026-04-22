import { readFile, readdir, lstat, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
export async function safeReadFile(p) {
    try {
        return await readFile(p, 'utf-8');
    }
    catch {
        return null;
    }
}
export async function safeReaddir(p) {
    try {
        return await readdir(p);
    }
    catch {
        return [];
    }
}
export async function isDirectory(p) {
    try {
        return (await stat(p)).isDirectory();
    }
    catch {
        return false;
    }
}
export async function isBrokenSymlink(p) {
    try {
        const lstats = await lstat(p);
        if (!lstats.isSymbolicLink())
            return false;
        await realpath(p);
        return false;
    }
    catch {
        try {
            return (await lstat(p)).isSymbolicLink();
        }
        catch {
            return false;
        }
    }
}
export async function resolveRealPath(p) {
    try {
        return await realpath(p);
    }
    catch {
        return p;
    }
}
export async function getDirSize(dir) {
    let total = 0;
    const entries = await safeReaddir(dir);
    for (const entry of entries) {
        const p = join(dir, entry);
        try {
            const s = await stat(p);
            if (s.isFile())
                total += s.size;
            else if (s.isDirectory())
                total += await getDirSize(p);
        }
        catch { /* skip */ }
    }
    return total;
}
// execFile (not exec) — never routes through a shell, so command arguments
// cannot be interpreted as shell metacharacters regardless of caller inputs.
export async function runCommand(file, args) {
    try {
        const { execFile } = await import('node:child_process');
        return new Promise((resolve) => {
            execFile(file, args, { timeout: 10000 }, (_err, stdout) => {
                resolve(stdout || '');
            });
        });
    }
    catch {
        return '';
    }
}
