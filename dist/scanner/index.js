// INVARIANT: nothing in the scanner (this file or anything under scanner/**)
// may write to stdout. The CLI pipes stdout of `scan --json` to jq/other
// tools; a stray console.log would silently corrupt machine-readable output.
// Route diagnostics through console.error. Enforced by
// src/__tests__/scan-stdout-invariant.test.ts.
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { countTokensCached } from '../tokenizer.js';
import { getClaudeDir, getCurrentProjectSlug, getProjectsDir } from '../paths.js';
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
const DEFAULT_LOOKBACK_DAYS = 60;
export async function scan(opts = {}) {
    const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const [{ skills: localSkills, brokenSymlinks, contents }, { skills: pluginSkills, plugins, tempCaches }, { memoryFiles, staleProjects }, mcp, disabledPlugins, sessionUsage, userSurfaces,] = await Promise.all([
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
    // Estimate total tokens at startup. Skill/agent/command listing costs are
    // measured from each file's frontmatter description rather than assumed
    // (see scanner/skill-listing.ts) — the real spread is 30–500+ tokens apiece.
    const sumListing = (entries) => entries.reduce((sum, e) => sum + e.listingTokens, 0);
    // A disabled plugin's skills are not in the session catalog, so they cost
    // nothing at startup. Verified against a live session: skills from every
    // disabled plugin here (document-skills, superpowers, telegram, …) were
    // absent from the prompt, while enabled ones were present. Counting them put
    // 3,397 tokens — 27% of the total — into a number labelled "at session start".
    //
    // Only names reported *explicitly disabled* are dropped. `claude plugin list`
    // also emits `failed to load`, which the parser matches as neither enabled nor
    // disabled: railway reports it (a hook clash) and its twelve skills still
    // load. Treating anything unrecognised as disabled would have silently
    // deleted those from the total, so anything not known-disabled still counts.
    // Keyed on `<plugin>@<marketplace>`, not the bare name: the same plugin name
    // can be installed from two marketplaces in different states, and a name-only
    // set would drop the enabled copy along with the disabled one. `pluginName`
    // is the cache directory, which is the marketplace.
    //
    // An identity enabled anywhere is treated as enabled. `claude plugin list`
    // emits one row per scope, so the same identity legitimately appears twice —
    // and counting a live plugin is the safe error to make, not dropping it.
    const pluginIdentity = (plugin, marketplace) => `${plugin}@${marketplace}`;
    const enabledIdentities = new Set(installed.filter((p) => p.enabled).map((p) => pluginIdentity(p.name, p.marketplace)));
    const disabledIdentities = new Set(installed
        .filter((p) => !p.enabled)
        .map((p) => pluginIdentity(p.name, p.marketplace))
        .filter((id) => !enabledIdentities.has(id)));
    const isLoadedAtStartup = (s) => {
        if (s.plugin === undefined || s.pluginName === undefined)
            return true;
        return !disabledIdentities.has(pluginIdentity(s.plugin, s.pluginName));
    };
    const activePluginSkills = pluginSkills.filter(isLoadedAtStartup);
    const disabledPluginSkillTokens = sumListing(pluginSkills.filter((s) => !isLoadedAtStartup(s)));
    const skillListingTokens = sumListing(localSkills) + sumListing(activePluginSkills);
    const agentListingTokens = sumListing(userSurfaces.agents);
    const commandListingTokens = sumListing(userSurfaces.commands);
    // Memory is per-project: a session loads ~/.claude/projects/<slug>/memory/
    // for the project it is running in, and nothing from the other projects on
    // disk. Summing all of them (pre-2.8 behaviour) inflated the startup estimate
    // by a factor of however many projects the user had — 100k+ tokens on a busy
    // machine, for a number labelled "tokens at session start".
    const currentProjectSlug = getCurrentProjectSlug(opts.projectDir);
    const currentProjectMemoryTokens = memoryFiles
        .filter((m) => m.project === currentProjectSlug)
        .reduce((sum, m) => sum + m.tokens, 0);
    const allProjectsMemoryTokens = memoryFiles.reduce((sum, m) => sum + m.tokens, 0);
    const totalTokensBefore = skillListingTokens +
        agentListingTokens +
        commandListingTokens +
        claudeMdTokens +
        currentProjectMemoryTokens;
    const currentProjectKnown = await pathExists(join(getProjectsDir(), currentProjectSlug));
    // Only the skill-listing slice of a plugin's cost is recoverable startup
    // context — see sumRecoverableStartupTokens. Aggregated by plugin name the
    // same way `pluginCosts` is, so the two stay comparable.
    const pluginSkillListingTokens = new Map();
    for (const c of pluginCostBreakdowns) {
        pluginSkillListingTokens.set(c.pluginName, (pluginSkillListingTokens.get(c.pluginName) ?? 0) + c.skillTokens);
    }
    const recoverableStartupTokens = sumRecoverableStartupTokens(issues, [...localSkills, ...pluginSkills], currentProjectSlug, pluginSkillListingTokens);
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
        currentProjectKnown,
        currentProjectMemoryTokens,
        allProjectsMemoryTokens,
        recoverableStartupTokens,
        disabledPluginSkillTokens,
    };
}
async function pathExists(p) {
    try {
        await access(p);
        return true;
    }
    catch {
        return false;
    }
}
/** Issue types whose cleanup moves a skill directory out of the listing. */
const SKILL_MOVE_TYPES = new Set([
    'template', 'duplicate', 'skill_dup', 'oversized_skill', 'unused_skill',
    'backup_artifact',
]);
/**
 * What acting on every issue would actually save at session start.
 *
 * Two corrections over a naive `sum(issues.tokens)`, both of which inflate:
 *
 * - **Per-path, not per-issue.** The detectors are independent, so one skill
 *   routinely earns several findings at once (`duplicate` + `oversized_skill` +
 *   `unused_skill`). Removing it once collects the saving once.
 * - **Listing tokens, not body tokens.** `Issue.tokens` is the whole SKILL.md,
 *   which is loaded only when the skill runs. Startup pays for the catalog
 *   line alone. Conflating the two overstated savings ~80× in practice.
 *
 * Memory issues count only when they belong to the current project — the same
 * per-project rule `totalTokensBefore` follows. Deletions that free disk but no
 * context (`broken_symlink`, `temp_cache`) contribute nothing here by design.
 *
 * Three separate overlaps have to be collapsed, since every one of them inflates:
 * the same skill path, the same plugin across cached versions, and a memory file
 * that its own stale project already accounts for.
 */
export function sumRecoverableStartupTokens(issues, skills, currentProjectSlug, 
/** Plugin name → its skill-listing tokens. See the `unused_plugin` branch. */
pluginSkillListingTokens = new Map()) {
    const listingByPath = new Map(skills.map((s) => [s.path, s.listingTokens]));
    const countedPaths = new Set();
    const countedPlugins = new Set();
    let total = 0;
    // `stale_project` names the slug alone; `oversized_memory` names
    // `<slug>/<file>`. Match both without letting a sibling slug through — plain
    // startsWith would count `-Users-me-app2` as part of `-Users-me-app`.
    const isCurrentProject = (name) => name === currentProjectSlug || name.startsWith(currentProjectSlug + '/');
    // Stale projects first: `stale_project.tokens` is the sum of every memory file
    // in that project, so counting it settles the per-file findings inside it too.
    // Charging both billed an oversized file twice and could claim more than the
    // project's entire memory.
    let currentProjectIsStale = false;
    for (const issue of issues) {
        if (issue.type !== 'stale_project' || !isCurrentProject(issue.name))
            continue;
        if (currentProjectIsStale)
            continue;
        currentProjectIsStale = true;
        total += issue.tokens;
    }
    for (const issue of issues) {
        if (SKILL_MOVE_TYPES.has(issue.type)) {
            if (countedPaths.has(issue.path))
                continue;
            countedPaths.add(issue.path);
            // A skill missing from the listing map costs nothing at startup.
            total += listingByPath.get(issue.path) ?? 0;
        }
        else if (issue.type === 'unused_plugin') {
            // Deliberately NOT `issue.tokens`. That is the plugin's full estimated
            // cost from computePluginCosts — CLAUDE.md section + skills + MCP tools +
            // commands — and two of those parts do not belong in a recovery figure
            // presented against `totalTokensBefore`:
            //   - the matched CLAUDE.md section is in the baseline but survives the
            //     cleanup, since disabling a plugin does not edit the user's
            //     CLAUDE.md (and this tool never modifies it at all);
            //   - the MCP-tool and command estimates are genuinely freed, but are not
            //     in the baseline, so counting them measures against a total that
            //     never included them.
            // The skill listings are the one component that is both. Deduped by name
            // because the surface scan walks version directories, so a plugin with
            // two cached versions raises two findings.
            if (countedPlugins.has(issue.name))
                continue;
            countedPlugins.add(issue.name);
            total += pluginSkillListingTokens.get(issue.name) ?? 0;
        }
        else if (issue.type === 'oversized_memory') {
            // Another project's memory never loads here, so trimming it saves this
            // session nothing.
            if (!isCurrentProject(issue.name))
                continue;
            if (currentProjectIsStale)
                continue; // already inside the stale-project total
            total += issue.tokens;
        }
    }
    return total;
}
