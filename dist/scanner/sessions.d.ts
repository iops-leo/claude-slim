export interface SessionScanResult {
    invokedSkills: Set<string>;
    dataAvailable: boolean;
    sessionsScanned: number;
    sessionsInWindow: number;
    mcpPrefixesInvoked: Set<string>;
    commandsInvoked: Set<string>;
    totalUserCallableInvocations: number;
}
export declare function extractSkillsFromTranscript(content: string): string[];
export declare function extractMcpPrefixesFromTranscript(content: string): Set<string>;
export declare function extractCommandsFromTranscript(content: string): Set<string>;
export declare function scanSessionUsage(lookbackDays: number): Promise<SessionScanResult>;
