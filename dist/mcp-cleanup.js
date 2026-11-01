import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { mkdir, readFile, writeFile, unlink, chmod, realpath, lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { getDisabledDir } from './paths.js';
import { addEntry, readManifestV2, writeManifestV2 } from './manifest.js';
import { removeMcpServer, addMcpServerJson } from './mcp-runtime.js';
import { getClaudeJsonPath } from './scanner/mcp.js';
import { sanitizeUntrusted } from './scanner/untrusted.js';
function isObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export function getMcpBackupDir() {
    return join(getDisabledDir(), 'mcp-backup');
}
export function isDisabledMcpEntry(e) {
    return e.type === 'unused_mcp' && 'backupPath' in e && 'scope' in e;
}
/** The directory `claude mcp` must run in to address this scope. */
function cwdFor(scope, issuePath) {
    return scope === 'local' ? issuePath : homedir();
}
/**
 * With `CLAUDE_CONFIG_DIR` set, the `claude` we shell out to reads and writes
 * `$CLAUDE_CONFIG_DIR/.claude.json` while this tool reads `~/.claude.json`.
 * Backing up one file and removing from the other could swap definitions on
 * restore, so refuse instead of guessing.
 */
function assertDefaultConfigDir() {
    if (process.env.CLAUDE_CONFIG_DIR) {
        throw new Error('CLAUDE_CONFIG_DIR is set; claude-slim reads ~/.claude.json and will not remove MCP servers ' +
            'from a different profile. Use `claude mcp remove` directly.');
    }
}
async function readServers(scope, projectKey) {
    let data;
    try {
        data = JSON.parse(await readFile(getClaudeJsonPath(), 'utf-8'));
    }
    catch {
        return null;
    }
    if (!isObject(data))
        return null;
    const container = scope === 'user' ? data : isObject(data.projects) ? data.projects[projectKey] : undefined;
    const servers = isObject(container) ? container.mcpServers : undefined;
    return isObject(servers) ? servers : null;
}
/**
 * Read the server's current definition straight from `~/.claude.json`.
 *
 * The issue's name went through the label sanitizer, so it may not be the raw
 * name — and two raw names (`server`, `server​`) can sanitize to the same
 * label. Require exactly one raw name in the scope to map to the label, and
 * require it to be the label itself; otherwise removing "by name" could take
 * out a different, in-use server.
 */
async function readDefinition(name, scope, projectKey) {
    const servers = await readServers(scope, projectKey);
    const matches = servers ? Object.keys(servers).filter((raw) => sanitizeUntrusted(raw) === name) : [];
    if (matches.length > 1 || (matches.length === 1 && matches[0] !== name)) {
        throw new Error(`MCP server name "${name}" is ambiguous in ${scope} scope; remove it with \`claude mcp remove\` directly`);
    }
    const def = servers?.[name];
    if (matches.length === 0 || !isObject(def)) {
        throw new Error(`MCP server "${name}" not found in ${scope} scope of ~/.claude.json`);
    }
    return def;
}
async function stillDefined(name, scope, projectKey) {
    const servers = await readServers(scope, projectKey);
    return servers !== null && isObject(servers[name]);
}
/**
 * Remove an unused user/local MCP server, keeping its definition for `restore`.
 *
 * Order: back up (0600) → remove via the CLI → record. The backup is deleted
 * only once the server is confirmed to still be in `~/.claude.json`; whenever
 * that is not certain, the backup stays and the error names its path. A server
 * is never left removed with neither its definition nor a backup on disk.
 */
export async function disableUnusedMcp(issue) {
    assertDefaultConfigDir();
    const scope = issue.mcpScope;
    if (scope !== 'user' && scope !== 'local') {
        throw new Error(`unused_mcp issue without a removable scope: ${issue.name}`);
    }
    const cwd = cwdFor(scope, issue.path);
    const config = await readDefinition(issue.name, scope, issue.path);
    const dir = getMcpBackupDir();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    const backupPath = join(dir, `${scope}-${Date.now()}-${randomBytes(4).toString('hex')}.json`);
    await writeFile(backupPath, JSON.stringify({ name: issue.name, scope, cwd, config }, null, 2), {
        mode: 0o600,
        flag: 'wx',
    });
    await chmod(backupPath, 0o600); // writeFile's mode is filtered by the umask
    const keptBackup = (why) => new Error(`${why}; the definition is kept at ${backupPath}`);
    try {
        await removeMcpServer(issue.name, scope, cwd);
    }
    catch (err) {
        // A timeout can land after the CLI already saved the removal. Delete the
        // backup only when the server is verifiably still there.
        if (await stillDefined(issue.name, scope, issue.path)) {
            await unlink(backupPath).catch(() => { });
            throw err;
        }
        throw keptBackup(`Removing "${issue.name}" reported an error but the server is gone (${err.message})`);
    }
    const entry = {
        type: 'unused_mcp',
        name: issue.name,
        scope,
        cwd,
        backupPath,
        disabledAt: new Date().toISOString(),
    };
    try {
        await addEntry(entry);
    }
    catch (err) {
        try {
            await addMcpServerJson(issue.name, scope, config, cwd);
        }
        catch {
            throw keptBackup(`Could not record the removal of "${issue.name}" or re-add it (${err.message})`);
        }
        await unlink(backupPath).catch(() => { });
        throw err;
    }
    return entry;
}
/**
 * The backup a manifest entry points at, resolved through symlinks and
 * required to be a regular file inside our own store. A tampered manifest
 * must not turn restore into "read any file, pass it to `claude`, delete it".
 */
async function resolveBackupPath(entry) {
    let root;
    let real;
    try {
        root = await realpath(getMcpBackupDir());
        real = await realpath(entry.backupPath);
    }
    catch {
        throw new Error(`Backup not found for MCP server "${entry.name}" at ${entry.backupPath}`);
    }
    if (!real.startsWith(root + sep) || !(await lstat(real)).isFile()) {
        throw new Error(`Refusing to restore from a backup outside ${root}: ${entry.backupPath}`);
    }
    return real;
}
/** Put a removed server back exactly as it was, then drop its record and backup. */
export async function restoreMcpServer(entry) {
    assertDefaultConfigDir();
    const backupPath = await resolveBackupPath(entry);
    let backup;
    try {
        backup = JSON.parse(await readFile(backupPath, 'utf-8'));
    }
    catch {
        throw new Error(`Backup for MCP server "${entry.name}" at ${backupPath} is unreadable`);
    }
    if (!isObject(backup) || backup.name !== entry.name || backup.scope !== entry.scope || !isObject(backup.config)) {
        throw new Error(`Backup for MCP server "${entry.name}" does not match its manifest entry`);
    }
    await addMcpServerJson(entry.name, entry.scope, backup.config, entry.cwd);
    const m = await readManifestV2();
    m.entries = m.entries.filter((e) => !(isDisabledMcpEntry(e) && e.backupPath === entry.backupPath));
    await writeManifestV2(m);
    await unlink(backupPath).catch(() => { });
}
