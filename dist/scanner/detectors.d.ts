import type { SkillInfo, BrokenSymlink, MemoryFile, PluginInfo, Issue } from '../types.js';
import type { TempCache } from './plugin-skills.js';
import type { StaleProject } from './memory.js';
import type { PluginSurfaces } from './plugin-surfaces.js';
import type { McpServerEntry } from './mcp.js';
export interface DetectorContext {
    localSkills: SkillInfo[];
    pluginSkills: SkillInfo[];
    brokenSymlinks: BrokenSymlink[];
    memoryFiles: MemoryFile[];
    tempCaches: TempCache[];
    staleProjects: StaleProject[];
    disabledPlugins: Set<string>;
    plugins: PluginInfo[];
    contents: Map<string, string>;
    recentSkillInvocations: Set<string>;
    sessionDataAvailable: boolean;
    lookbackDays: number;
    pluginSurfaces: PluginSurfaces[];
    enabledPlugins: Array<{
        name: string;
        marketplace: string;
    }>;
    recentMcpPrefixes: Set<string>;
    recentCommands: Set<string>;
    totalUserCallableInvocations: number;
    sessionsInWindow: number;
    pluginCosts: Map<string, number>;
    mcpServers: McpServerEntry[];
    /** `~/.claude.json` project key local-scope servers live under. */
    mcpProjectKey: string;
    claudeJsonPath: string;
}
export interface Detector {
    name: string;
    detect(ctx: DetectorContext): Issue[];
}
export declare const detectors: Detector[];
export declare function classifyIssues(ctx: DetectorContext, registry?: Detector[]): Issue[];
