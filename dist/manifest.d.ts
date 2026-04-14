import type { ManifestEntry } from './types.js';
export declare function getDisabledDir(): string;
export declare function ensureDisabledDir(): Promise<void>;
export declare function readManifest(): Promise<ManifestEntry[]>;
export declare function appendManifest(entry: ManifestEntry): Promise<void>;
