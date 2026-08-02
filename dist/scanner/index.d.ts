import type { ScanResult } from '../types.js';
export interface ScanOptions {
    lookbackDays?: number;
    /**
     * Directory whose project memory counts toward the startup estimate.
     *
     * Defaults to `process.cwd()`, which is wrong whenever the CLI is launched
     * from its own install directory — the `/claude-slim` skill does exactly that
     * via `cd "${CLAUDE_PLUGIN_ROOT}"`, and every project-memory token silently
     * dropped out of the total as a result.
     */
    projectDir?: string;
}
export declare function scan(opts?: ScanOptions): Promise<ScanResult>;
