import type { ScanResult, SkillInfo } from './types.js';
export declare const SKILL_PROMPT_OVERHEAD_TOKENS = 30;
interface SkillCandidate {
    skill: SkillInfo;
    realMdPath: string;
}
export declare function dedupeBySymlink(candidates: SkillCandidate[]): SkillInfo[];
export declare function parseDisabledPlugins(output: string): Set<string>;
export declare function parseClaudeMdSections(content: string): Array<{
    name: string;
    sizeBytes: number;
    tokens: number;
}>;
export declare function scan(): Promise<ScanResult>;
export {};
