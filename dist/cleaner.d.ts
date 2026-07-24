import type { Issue, ManifestEntry, DisabledPluginEntry } from './types.js';
export interface CleanResult {
    moved: ManifestEntry[];
    skipped: string[];
    errors: Array<{
        name: string;
        error: string;
    }>;
    /**
     * Populated when one or more `unused_plugin` items were requested but the
     * `claude` CLI is missing from PATH. The CLI surfaces this once at the top of
     * the error block instead of N repeat rows.
     */
    claudeCliMissing?: boolean;
}
export declare function cleanIssues(issues: Issue[]): Promise<CleanResult>;
export declare function restoreItem(entry: ManifestEntry | DisabledPluginEntry): Promise<void>;
