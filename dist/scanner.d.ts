import type { ScanResult, SkillInfo } from './types.js';
interface SkillCandidate {
    skill: SkillInfo;
    realMdPath: string;
}
export declare function dedupeBySymlink(candidates: SkillCandidate[]): SkillInfo[];
export declare function parseClaudeMdSections(content: string): Array<{
    name: string;
    sizeBytes: number;
    tokens: number;
}>;
export declare function scan(): Promise<ScanResult>;
export {};
