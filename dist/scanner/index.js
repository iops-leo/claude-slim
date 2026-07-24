// INVARIANT: nothing in the scanner (this file or anything under scanner/**)
// may write to stdout. The CLI pipes stdout of `scan --json` to jq/other
// tools; a stray console.log would silently corrupt machine-readable output.
// Route diagnostics through console.error. Enforced by
// src/__tests__/scan-stdout-invariant.test.ts.
import { join } from 'node:path';
import { countTokensCached } from '../tokenizer.js';
import { getClaudeDir } from '../paths.js';
import { safeReadFile } from './fs-walk.js';
import { scanLocalSkills } from './local-skills.js';
import { scanPluginSkills } from './plugin-skills.js';
import { scanMemoryFiles } from './memory.js';
import { scanMcpServers } from './mcp.js';
import { parseClaudeMdSections } from './claude-md.js';
import { getDisabledPlugins, getInstalledPlugins } from './disabled-plugins.js';
import { scanSessionUsage } from './sessions.js';
import { classifyIssues } from './detectors.js';
import { scanPluginSurfaces } from './plugin-surfaces.js';
import { computePluginBreakdown } from './plugin-breakdown.js';
import { computePluginCosts } from './plugin-cost.js';
import { SKILL_PROMPT_OVERHEAD_TOKENS } from './constants.js';
const DEFAULT_LOOKBACK_DAYS = 60;
export async function scan(opts = {}) {
    const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const [{ skills: localSkills, brokenSymlinks, contents }, { skills: pluginSkills, plugins, tempCaches }, { memoryFiles, staleProjects }, mcp, disabledPlugins, sessionUsage,] = await Promise.all([
        scanLocalSkills(),
        scanPluginSkills(),
        scanMemoryFiles(),
        scanMcpServers(),
        getDisabledPlugins(),
        scanSessionUsage(lookbackDays),
    ]);
    const pluginSurfaces = scanPluginSurfaces();
    // Annotate plugin status
    for (const plugin of plugins) {
        plugin.status = disabledPlugins.has(plugin.name) ? 'disabled' : 'enabled';
    }
    // Build enabled plugin list for unused_plugin detector. `plugins[].name` from
    // existing code is the marketplace name (intentional, for cache-dir matching).
    // For unused_plugin we need the actual plugin name parsed from
    // `claude plugin list` output (the `<plugin>` part of `<plugin>@<marketplace>`).
    const installed = await getInstalledPlugins();
    const enabledPlugins = installed
        .filter((p) => p.enabled)
        .map((p) => ({ name: p.name, marketplace: p.marketplace }));
    // CLAUDE.md
    const claudeMdContent = await safeReadFile(join(getClaudeDir(), 'CLAUDE.md'));
    const claudeMdBytes = claudeMdContent ? Buffer.byteLength(claudeMdContent) : 0;
    const claudeMdTokens = claudeMdContent
        ? countTokensCached(claudeMdContent, join(getClaudeDir(), 'CLAUDE.md'))
        : 0;
    const claudeMdSections = claudeMdContent ? parseClaudeMdSections(claudeMdContent) : [];
    // Per-plugin cost map for the unused_plugin detector's savings estimate.
    // Aggregates when multiple surface entries share a pluginName (mirrors the
    // same logic in computePluginBreakdown).
    const pluginCostBreakdowns = computePluginCosts(pluginSurfaces, claudeMdSections);
    const pluginCosts = new Map();
    for (const c of pluginCostBreakdowns) {
        pluginCosts.set(c.pluginName, (pluginCosts.get(c.pluginName) ?? 0) + c.totalEstimatedTokens);
    }
    const issues = classifyIssues({
        localSkills, pluginSkills, brokenSymlinks, memoryFiles,
        tempCaches, staleProjects, disabledPlugins, plugins,
        contents,
        recentSkillInvocations: sessionUsage.invokedSkills,
        sessionDataAvailable: sessionUsage.dataAvailable,
        lookbackDays,
        pluginSurfaces,
        enabledPlugins,
        recentMcpPrefixes: sessionUsage.mcpPrefixesInvoked,
        recentCommands: sessionUsage.commandsInvoked,
        totalUserCallableInvocations: sessionUsage.totalUserCallableInvocations,
        sessionsInWindow: sessionUsage.sessionsInWindow,
        pluginCosts,
    });
    // Compute plugin breakdown (used by PLUGINS table in scan output)
    const pluginBreakdown = computePluginBreakdown({
        surfaces: pluginSurfaces,
        installedPlugins: installed,
        invokedSkills: sessionUsage.invokedSkills,
        mcpPrefixesInvoked: sessionUsage.mcpPrefixesInvoked,
        commandsInvoked: sessionUsage.commandsInvoked,
        totalUserCallableInvocations: sessionUsage.totalUserCallableInvocations,
        sessionsInWindow: sessionUsage.sessionsInWindow,
        claudeMdSections,
    });
    // Estimate total tokens at startup
    const skillListingTokens = (localSkills.length + pluginSkills.length) * SKILL_PROMPT_OVERHEAD_TOKENS;
    const memoryTokens = memoryFiles.reduce((sum, m) => sum + m.tokens, 0);
    const totalTokensBefore = skillListingTokens + claudeMdTokens + memoryTokens;
    return {
        localSkills,
        pluginSkills,
        plugins,
        brokenSymlinks,
        memoryFiles,
        claudeMdBytes,
        claudeMdTokens,
        claudeMdSections,
        mcpServers: mcp.count,
        mcpServerNames: mcp.names,
        issues,
        totalTokensBefore,
        pluginBreakdown,
    };
}
