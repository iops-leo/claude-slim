import type { ScanResult } from './types.js';
export declare function parseClaudeMdSections(content: string): Array<{
    name: string;
    sizeBytes: number;
    tokens: number;
}>;
export declare function scan(): Promise<ScanResult>;
