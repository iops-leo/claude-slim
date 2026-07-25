import { DEFERRED_TOOL_OVERHEAD_TOKENS, COMMAND_OVERHEAD_TOKENS, MCP_SERVER_TOOLS_AVG, } from './constants.js';
/**
 * Find a CLAUDE.md section whose name contains the plugin name as a substring
 * (case-insensitive). Returns the first match or null.
 * Fuzzy matching is intentionally disabled to avoid false positives.
 */
function matchSection(pluginName, sections) {
    const lower = pluginName.toLowerCase();
    return sections.find((s) => s.name.toLowerCase().includes(lower)) ?? null;
}
/**
 * Compute estimated system-prompt token cost for each plugin.
 *
 * All returned token counts are estimates (±20%). Callers should surface
 * them with a `~` prefix in any UI output.
 */
export function computePluginCosts(surfaces, claudeMdSections) {
    return surfaces.map((s) => {
        const matched = matchSection(s.pluginName, claudeMdSections);
        const claudeMdTokens = matched?.tokens ?? 0;
        const skillTokens = s.skillListingTokens;
        const mcpToolTokens = DEFERRED_TOOL_OVERHEAD_TOKENS * MCP_SERVER_TOOLS_AVG * s.mcpServerKeys.length;
        const commandTokens = COMMAND_OVERHEAD_TOKENS * s.commands.length;
        const totalEstimatedTokens = claudeMdTokens + skillTokens + mcpToolTokens + commandTokens;
        return {
            pluginName: s.pluginName,
            marketplace: s.marketplace,
            claudeMdTokens,
            skillTokens,
            mcpToolTokens,
            commandTokens,
            totalEstimatedTokens,
        };
    });
}
