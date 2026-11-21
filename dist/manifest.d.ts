import type { Manifest, ManifestEntry, AnyManifestEntry, DisabledPluginEntry } from './types.js';
import type { AgentId } from './paths.js';
export declare function getDisabledDir(): string;
/** Create (if needed) and return the disabled-skill store for one agent. */
export declare function ensureDisabledDir(agent?: AgentId): Promise<string>;
export declare function migrateLegacyIfNeeded(): Promise<void>;
/**
 * The manifest exists but cannot be used. It is the only record of what clean
 * moved and how to put it back, so nothing may write over it: callers stop
 * instead of treating it as empty.
 */
export declare class ManifestCorruptError extends Error {
    constructor(path: string, reason: string, copy: string | null);
}
export declare function readManifestV2(): Promise<Manifest>;
export declare function writeManifestV2(manifest: Manifest): Promise<void>;
export declare function addEntry(entry: AnyManifestEntry): Promise<void>;
/**
 * Remove one skill/memory entry. Pass `match` to pin it to an agent and
 * original path: a Claude skill and a Codex skill can share a name, and a
 * name-only match let restoring one erase the other's record.
 */
export declare function removeEntry(name: string, match?: {
    agent?: AgentId;
    from?: string;
}): Promise<ManifestEntry | null>;
export declare function recordDisabledPlugin(plugin: string, marketplace: string): Promise<void>;
export declare function findDisabledPlugin(plugin: string, marketplace: string): Promise<DisabledPluginEntry | undefined>;
export declare function removeDisabledPlugin(plugin: string, marketplace: string): Promise<boolean>;
export declare function readManifest(): Promise<AnyManifestEntry[]>;
export declare function appendManifest(entry: AnyManifestEntry): Promise<void>;
