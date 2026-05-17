import type { Issue, ManifestEntry, DisabledPluginEntry } from './types.js';
export interface CleanResult {
    moved: ManifestEntry[];
    skipped: string[];
    errors: Array<{
        name: string;
        error: string;
    }>;
}
export declare function cleanIssues(issues: Issue[]): Promise<CleanResult>;
export declare function restoreItem(entry: ManifestEntry | DisabledPluginEntry): Promise<void>;
