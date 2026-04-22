import type { SkillInfo, PluginInfo } from '../types.js';
export interface TempCache {
    name: string;
    path: string;
    sizeKB: number;
}
export interface PluginSkillsResult {
    skills: SkillInfo[];
    plugins: PluginInfo[];
    tempCaches: TempCache[];
}
export declare function scanPluginSkills(): Promise<PluginSkillsResult>;
