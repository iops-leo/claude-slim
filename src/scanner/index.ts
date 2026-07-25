// INVARIANT: nothing in the scanner (this file or anything under scanner/**)
// may write to stdout. The CLI pipes stdout of `scan --json` to jq/other
// tools; a stray console.log would silently corrupt machine-readable output.
// Route diagnostics through console.error. Enforced by
// src/__tests__/scan-stdout-invariant.test.ts.
import { join } from 'node:path';
import { countTokensCached } from '../tokenizer.js';
import { getClaudeDir, getCurrentProjectSlug } from '../paths.js';
import type { ScanResult } from '../types.js';
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
import { scanUserSurfaces } from './user-surfaces.js';

export interface ScanOptions {
  // Days of session history to consider when classifying skills as unused.
  // Default 60: long enough to absorb a month-off-then-resume cadence,
  // short enough that "stale by inactivity" remains meaningful.
  lookbackDays?: number;
}

const DEFAULT_LOOKBACK_DAYS = 60;

export async function scan(opts: ScanOptions = {}): Promise<ScanResult> {
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const [
    { skills: localSkills, brokenSymlinks, contents },
    { skills: pluginSkills, plugins, tempCaches },
    { memoryFiles, staleProjects },
    mcp,
    disabledPlugins,
    sessionUsage,
    userSurfaces,
  ] = await Promise.all([
    scanLocalSkills(),
    scanPluginSkills(),
    scanMemoryFiles(),
    scanMcpServers(),
    getDisabledPlugins(),
    scanSessionUsage(lookbackDays),
    scanUserSurfaces(),
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
  const pluginCosts = new Map<string, number>();
  for (const c of pluginCostBreakdowns) {
    pluginCosts.set(
      c.pluginName,
      (pluginCosts.get(c.pluginName) ?? 0) + c.totalEstimatedTokens,
    );
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

  // Estimate total tokens at startup. Skill/agent/command listing costs are
  // measured from each file's frontmatter description rather than assumed
  // (see scanner/skill-listing.ts) — the real spread is 30–500+ tokens apiece.
  const sumListing = (entries: Array<{ listingTokens: number }>): number =>
    entries.reduce((sum, e) => sum + e.listingTokens, 0);

  const skillListingTokens = sumListing(localSkills) + sumListing(pluginSkills);
  const agentListingTokens = sumListing(userSurfaces.agents);
  const commandListingTokens = sumListing(userSurfaces.commands);

  // Memory is per-project: a session loads ~/.claude/projects/<slug>/memory/
  // for the project it is running in, and nothing from the other projects on
  // disk. Summing all of them (pre-2.8 behaviour) inflated the startup estimate
  // by a factor of however many projects the user had — 100k+ tokens on a busy
  // machine, for a number labelled "tokens at session start".
  const currentProjectSlug = getCurrentProjectSlug();
  const currentProjectMemoryTokens = memoryFiles
    .filter((m) => m.project === currentProjectSlug)
    .reduce((sum, m) => sum + m.tokens, 0);
  const allProjectsMemoryTokens = memoryFiles.reduce((sum, m) => sum + m.tokens, 0);

  const totalTokensBefore =
    skillListingTokens +
    agentListingTokens +
    commandListingTokens +
    claudeMdTokens +
    currentProjectMemoryTokens;

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
    userAgents: userSurfaces.agents,
    userCommands: userSurfaces.commands,
    currentProjectSlug,
    currentProjectMemoryTokens,
    allProjectsMemoryTokens,
  };
}
