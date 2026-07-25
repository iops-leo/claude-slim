import type { PluginSurfaces } from './plugin-surfaces.js';
export interface PluginCostBreakdown {
    pluginName: string;
    marketplace: string;
    /** Tokens from the matching CLAUDE.md section (0 if no match). */
    claudeMdTokens: number;
    /** Measured sum of each skill's `- <name>: <description>` listing line. */
    skillTokens: number;
    /** DEFERRED_TOOL_OVERHEAD_TOKENS × MCP_SERVER_TOOLS_AVG × mcpServerKeys.length */
    mcpToolTokens: number;
    /** COMMAND_OVERHEAD_TOKENS × commands.length */
    commandTokens: number;
    /** Sum of all fields above. All values are estimates (~). */
    totalEstimatedTokens: number;
}
export interface ClaudeMdSection {
    name: string;
    sizeBytes: number;
    tokens: number;
}
/**
 * Compute estimated system-prompt token cost for each plugin.
 *
 * All returned token counts are estimates (±20%). Callers should surface
 * them with a `~` prefix in any UI output.
 */
export declare function computePluginCosts(surfaces: PluginSurfaces[], claudeMdSections: ClaudeMdSection[]): PluginCostBreakdown[];
