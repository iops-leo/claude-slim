import type { MemoryFile } from '../types.js';
export interface StaleProject {
    project: string;
    path: string;
    ageDays: number;
    fileCount: number;
    totalBytes: number;
}
export interface MemoryScanResult {
    memoryFiles: MemoryFile[];
    staleProjects: StaleProject[];
}
export declare function scanMemoryFiles(): Promise<MemoryScanResult>;
