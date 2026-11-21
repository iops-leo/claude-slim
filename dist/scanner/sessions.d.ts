export interface SessionScanResult {
    invokedSkills: Set<string>;
    dataAvailable: boolean;
    sessionsScanned: number;
    sessionsInWindow: number;
    mcpPrefixesInvoked: Set<string>;
    commandsInvoked: Set<string>;
    totalUserCallableInvocations: number;
    /**
     * Days the surviving logs actually cover; 0 with no logs in the window.
     * When `cleanupPeriodDays` keeps logs at least as long as the lookback,
     * nothing in the window was deleted and this is the age of the oldest log
     * on disk, capped at the lookback.
     * Otherwise it is the age of the oldest session log inside the window,
     * rounded up and capped at the lookback. Logs older than the window are
     * ignored — a lone straggler that escaped cleanup says nothing about the
     * days after it. Claude Code deletes
     * logs older than `cleanupPeriodDays`, so this is what "not invoked in Nd"
     * can honestly rest on.
     */
    effectiveLookbackDays: number;
}
/** Claude Code's default `cleanupPeriodDays`. */
export declare const DEFAULT_CLEANUP_PERIOD_DAYS = 30;
/** `cleanupPeriodDays` from this profile's settings.json, else Claude Code's default. */
export declare function readCleanupPeriodDays(): Promise<number>;
export declare function extractSkillsFromTranscript(content: string): string[];
export declare function extractMcpPrefixesFromTranscript(content: string): Set<string>;
export declare function extractCommandsFromTranscript(content: string): Set<string>;
export declare function scanSessionUsage(lookbackDays: number): Promise<SessionScanResult>;
