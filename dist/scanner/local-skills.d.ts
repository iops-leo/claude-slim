import type { SkillInfo, BrokenSymlink } from '../types.js';
export interface SkillCandidate {
    skill: SkillInfo;
    realMdPath: string;
}
export declare function dedupeBySymlink(candidates: SkillCandidate[]): SkillInfo[];
export interface LocalSkillsResult {
    skills: SkillInfo[];
    brokenSymlinks: BrokenSymlink[];
    contents: Map<string, string>;
}
export declare function scanLocalSkills(): Promise<LocalSkillsResult>;
