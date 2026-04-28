export interface SessionScanResult {
    invokedSkills: Set<string>;
    dataAvailable: boolean;
    sessionsScanned: number;
    sessionsInWindow: number;
}
export declare function extractSkillsFromTranscript(content: string): string[];
export declare function scanSessionUsage(lookbackDays: number): Promise<SessionScanResult>;
