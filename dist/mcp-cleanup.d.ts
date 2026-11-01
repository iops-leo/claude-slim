import type { Issue, DisabledMcpEntry, AnyManifestEntry } from './types.js';
/**
 * Dot-prefixed so it can never collide with a disabled skill: skills move to
 * `skills.disabled/<name>/`, and no scanned skill name starts with `.`. A
 * plain `mcp-backup/` would be swallowed by restoring a skill of that name.
 */
export declare function getMcpBackupDir(): string;
export declare function isDisabledMcpEntry(e: AnyManifestEntry): e is DisabledMcpEntry;
/**
 * Remove an unused user/local MCP server, keeping its definition for `restore`.
 *
 * Order: back up (0600) → remove via the CLI → record. The backup is deleted
 * only once the server is confirmed to still be in `~/.claude.json`; whenever
 * that is not certain, the backup stays and the error names its path. A server
 * is never left removed with neither its definition nor a backup on disk.
 */
export declare function disableUnusedMcp(issue: Issue): Promise<DisabledMcpEntry>;
/** Put a removed server back exactly as it was, then drop its record and backup. */
export declare function restoreMcpServer(entry: DisabledMcpEntry): Promise<void>;
