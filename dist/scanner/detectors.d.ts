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
/**
 * The prefix `extractMcpPrefixesFromTranscript` records for this server's
 * tools. It splits `mcp__<prefix>__<tool>` at the first `__` after `mcp__`, so
 * `my__srv` is recorded as `my`, `srv_` (tool `mcp__srv___t`) as `srv`, and a
 * name starting with `__` as the empty string. Matching on the same split errs
 * toward "used", never toward removing a live server.
 */
export declare function recordedMcpPrefix(toolPrefix: string): string;
export declare const detectors: Detector[];
export declare function classifyIssues(ctx: DetectorContext, registry?: Detector[]): Issue[];
