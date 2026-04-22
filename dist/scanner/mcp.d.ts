export interface McpScanResult {
    count: number;
    names: string[];
}
export declare function scanMcpServers(): Promise<McpScanResult>;
