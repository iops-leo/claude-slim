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
/**
 * The part of MEMORY.md a session actually receives: the first 200 lines or
 * the first 25KB, whichever ends sooner. Everything past that is on disk but
 * never in context — which is worth flagging, because an index that has
 * quietly stopped listing its newest entries defeats its purpose.
 */
export declare function memoryIndexStartupSlice(content: string): {
    text: string;
    truncated: boolean;
};
export declare function scanMemoryFiles(): Promise<MemoryScanResult>;
