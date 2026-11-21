import { join } from 'node:path';
import { getPluginsDir } from '../paths.js';
import type { SkillInfo, BrokenSymlink, MemoryFile, PluginInfo, Issue } from '../types.js';
import type { TempCache } from './plugin-skills.js';
import type { StaleProject } from './memory.js';
import type { PluginSurfaces } from './plugin-surfaces.js';
import type { McpServerEntry } from './mcp.js';
import {
  OVERSIZED_SKILL_BYTES, OVERSIZED_MEMORY_BYTES, SKILL_PROMPT_OVERHEAD_TOKENS,
  MCP_SERVER_TOOLS_AVG, DEFERRED_TOOL_OVERHEAD_TOKENS,
} from './constants.js';
import { detectBackupArtifact } from './backup-artifacts.js';
import { isLocalSkillUsed, isPluginSurfaceUsed } from './usage-match.js';

// Everything a detector needs — threaded explicitly through context instead of
// relying on module-global state, so detectors are pure functions of their input.
export interface DetectorContext {
  localSkills: SkillInfo[];
  pluginSkills: SkillInfo[];
  brokenSymlinks: BrokenSymlink[];
  memoryFiles: MemoryFile[];
  tempCaches: TempCache[];
  staleProjects: StaleProject[];
  /** Disabled plugins as `<plugin>@<marketplace>`. */
  disabledPlugins: Set<string>;
  plugins: PluginInfo[];
  // SKILL.md content keyed by absolute path, populated during local-skill scan.
  // Detectors that peek into content (e.g. template marker) read from here
  // rather than re-reading the file.
  contents: Map<string, string>;
  // Skill identifiers (e.g. 'init', 'superpowers:brainstorming') invoked via
  // the Skill tool in any session log within the lookback window.
  recentSkillInvocations: Set<string>;
  // false → unused-skill detector must return [] (insufficient session data
  // or schema drift; see scanner/sessions.ts).
  sessionDataAvailable: boolean;
  lookbackDays: number;
  /**
   * Days the surviving session logs cover (see SessionScanResult). Absent
   * means the whole lookback. Issue details claim only this much.
   */
  effectiveLookbackDays?: number;
  // v2.6 unused_plugin detector fields
  pluginSurfaces: PluginSurfaces[];
  enabledPlugins: Array<{ name: string; marketplace: string }>;
  recentMcpPrefixes: Set<string>;
  recentCommands: Set<string>;
  /** `plugin@marketplace` identities `.claude.json` `pluginUsage` saw used inside the lookback. */
  usedPlugins?: Set<string>;
  totalUserCallableInvocations: number;
  sessionsInWindow: number;
  // Per-plugin estimated token cost keyed by plugin name. Populated from
  // computePluginCosts(); used by unused_plugin to report accurate savings.
  pluginCosts: Map<string, number>;
  // v2.16 unused_mcp detector fields
  mcpServers: McpServerEntry[];
  /** `~/.claude.json` project key local-scope servers live under. */
  mcpProjectKey: string;
  claudeJsonPath: string;
}

/**
 * The span an "unused" finding rests on. Claude Code deletes logs after
 * `cleanupPeriodDays`, so a 60-day lookback may be backed by 30 days of logs;
 * saying "60d" then overclaims.
 */
function usageWindowLabel(lookbackDays: number, effective: number | undefined): string {
  return effective !== undefined && effective < lookbackDays
    ? `${effective}d of logs`
    : `${lookbackDays}d`;
}

// A Detector is a pure function of context → Issue[]. Add a new detector by
// writing a function here and pushing it into `detectors` below. No other
// module needs to change. See CONTRIBUTING.md for the full walkthrough.
export interface Detector {
  name: string;
  detect(ctx: DetectorContext): Issue[];
}

const brokenSymlinkDetector: Detector = {
  name: 'broken_symlink',
  detect({ brokenSymlinks }) {
    return brokenSymlinks.map((link) => ({
      type: 'broken_symlink' as const,
      tier: 1 as const,
      name: link.name,
      detail: link.target,
      tokens: 0,
      path: link.path,
    }));
  },
};

const templateDetector: Detector = {
  name: 'template',
  detect({ localSkills, contents }) {
    const issues: Issue[] = [];
    for (const skill of localSkills) {
      const skillMdPath = join(skill.path, 'SKILL.md');
      const content = contents.get(skillMdPath);
      if (content && content.includes('Replace with description')) {
        issues.push({
          type: 'template',
          tier: 1,
          name: skill.name,
          tokens: skill.tokens,
          path: skill.path,
        });
      }
    }
    return issues;
  },
};

const duplicateDetector: Detector = {
  name: 'duplicate',
  detect({ localSkills, pluginSkills }) {
    const pluginSkillNames = new Set(pluginSkills.map((s) => s.name));
    const issues: Issue[] = [];
    for (const skill of localSkills) {
      // Exact-name match only. A prior baseName fallback flagged nested local
      // skills (e.g. `org/ship`) as duplicates of a bare plugin `ship`, but
      // namespaced local skills are addressable independently and are not real
      // duplicates — the fallback risked disabling user content.
      if (pluginSkillNames.has(skill.name)) {
        issues.push({
          type: 'duplicate',
          tier: 2,
          name: skill.name,
          detail: 'local+plugin',
          tokens: skill.tokens,
          path: skill.path,
        });
      }
    }
    return issues;
  },
};

const oversizedSkillDetector: Detector = {
  name: 'oversized_skill',
  detect({ localSkills }) {
    const issues: Issue[] = [];
    for (const skill of localSkills) {
      if (skill.sizeBytes > OVERSIZED_SKILL_BYTES) {
        issues.push({
          type: 'oversized_skill',
          tier: 3,
          name: skill.name,
          detail: `${Math.round(skill.sizeBytes / 1024)}KB`,
          tokens: skill.tokens,
          path: skill.path,
        });
      }
    }
    return issues;
  },
};

const skillDupDetector: Detector = {
  name: 'skill_dup',
  detect({ localSkills }) {
    const issues: Issue[] = [];
    for (const skill of localSkills) {
      const dotSkillDir = skill.path + '.skill';
      if (localSkills.some((s) => s.path === dotSkillDir)) {
        issues.push({
          type: 'skill_dup',
          tier: 1,
          name: skill.name,
          tokens: 0,
          path: dotSkillDir,
        });
      }
    }
    return issues;
  },
};

const tempCacheDetector: Detector = {
  name: 'temp_cache',
  detect({ tempCaches }) {
    return tempCaches.map((temp) => ({
      type: 'temp_cache' as const,
      tier: 1 as const,
      name: temp.name,
      detail: `${temp.sizeKB}KB`,
      tokens: 0,
      path: temp.path,
    }));
  },
};

// Only MEMORY.md is loaded at startup, so only MEMORY.md can be "oversized"
// in the sense this tool cares about. A 40KB topic file costs nothing until
// Claude decides to read it; flagging it (pre-2.15 behaviour) produced a
// wall of recommendations whose cleanup would have saved no startup context.
const oversizedMemoryDetector: Detector = {
  name: 'oversized_memory',
  detect({ memoryFiles }) {
    const issues: Issue[] = [];
    for (const mem of memoryFiles) {
      if (!mem.isIndex || mem.sizeBytes <= OVERSIZED_MEMORY_BYTES) continue;
      const size = `${Math.round(mem.sizeBytes / 1024)}KB`;
      issues.push({
        type: 'oversized_memory',
        tier: 2,
        name: `${mem.project}/${mem.name}`,
        detail: mem.truncated
          ? `${size}, truncated at startup — entries past 200 lines/25KB are never loaded`
          : size,
        tokens: mem.startupTokens,
        path: mem.path,
      });
    }
    return issues;
  },
};

const staleProjectDetector: Detector = {
  name: 'stale_project',
  detect({ staleProjects, memoryFiles }) {
    return staleProjects.map((stale) => {
      // What a session in that project pays at startup — its index slice —
      // not the whole directory, which is disk, not context.
      const memTokens = memoryFiles
        .filter((m) => m.project === stale.project)
        .reduce((sum, m) => sum + m.startupTokens, 0);
      return {
        type: 'stale_project' as const,
        tier: 2 as const,
        name: stale.project,
        detail: `${stale.ageDays}d, ${stale.fileCount} files, ${Math.round(stale.totalBytes / 1024)}KB`,
        tokens: memTokens,
        path: stale.path,
      };
    });
  },
};

const unusedSkillDetector: Detector = {
  name: 'unused_skill',
  detect({
    localSkills,
    recentSkillInvocations,
    recentCommands,
    recentMcpPrefixes,
    sessionDataAvailable,
    sessionsInWindow,
    lookbackDays,
    effectiveLookbackDays,
  }) {
    const signals = {
      skills: recentSkillInvocations,
      commands: recentCommands,
      mcpPrefixes: recentMcpPrefixes,
    };
    // Suppress entirely when the data source is unreliable — better no signal
    // than a wrong one that flags every skill as unused. `sessionDataAvailable`
    // needs a Skill tool call; someone who only types `/daily` never makes one.
    // An installed skill seen in use by any signal proves the logs parse just
    // as well, so it satisfies the gate too.
    const corroborated =
      sessionDataAvailable ||
      (sessionsInWindow >= 3 && localSkills.some((s) => isLocalSkillUsed(s.name, signals)));
    if (!corroborated) return [];
    const issues: Issue[] = [];
    for (const skill of localSkills) {
      if (isLocalSkillUsed(skill.name, signals)) continue;
      issues.push({
        type: 'unused_skill',
        tier: 3,
        name: skill.name,
        detail: `not invoked in ${usageWindowLabel(lookbackDays, effectiveLookbackDays)}`,
        tokens: skill.tokens,
        path: skill.path,
      });
    }
    return issues;
  },
};

const unusedPluginDetector: Detector = {
  name: 'unused_plugin',
  detect({
    pluginSurfaces,
    enabledPlugins,
    recentSkillInvocations,
    recentMcpPrefixes,
    recentCommands,
    usedPlugins,
    totalUserCallableInvocations,
    sessionsInWindow,
    lookbackDays,
    effectiveLookbackDays,
    pluginCosts,
  }) {
    // (a) Global suppression: too few sessions to draw a conclusion
    if (sessionsInWindow < 3) return [];
    // (b) Global suppression: no user-callable activity — schema change suspected
    if (totalUserCallableInvocations === 0) return [];

    const enabledNames = new Set(enabledPlugins.map((p) => p.name));
    const issues: Issue[] = [];

    for (const ps of pluginSurfaces) {
      // Inner-join: only consider plugins reported as enabled (filters .git noise)
      if (!enabledNames.has(ps.pluginName)) continue;

      // (c) Per-plugin suppression: no user-callable surface (agent/hook only)
      const userCallableCount =
        ps.skills.length + ps.mcpToolPrefixes.length + ps.commands.length;
      if (userCallableCount === 0) continue;

      // (d) suppression was intended to skip recently-installed plugins by
      // `installedAt` mtime, but dogfooding showed `claude plugin update` resets
      // cache mtime indiscriminately, making install age unreliable. Dropped.
      // Tier 3 (never auto-selected) lets users sanity-check any flagged plugin.

      if (usedPlugins?.has(`${ps.pluginName}@${ps.marketplace}`)) continue;
      // Usage check: any skill/mcp/command from this plugin invoked?
      if (isPluginSurfaceUsed(ps, {
        skills: recentSkillInvocations,
        commands: recentCommands,
        mcpPrefixes: recentMcpPrefixes,
      })) continue;

      issues.push({
        type: 'unused_plugin',
        tier: 3,
        name: ps.pluginName,
        marketplace: ps.marketplace,
        detail: `not invoked in ${usageWindowLabel(lookbackDays, effectiveLookbackDays)} (${ps.marketplace})`,
        tokens: pluginCosts.get(ps.pluginName) ?? 0,
        path: ps.installDir,
      });
    }

    return issues;
  },
};

/**
 * The prefix `extractMcpPrefixesFromTranscript` records for this server's
 * tools. It splits `mcp__<prefix>__<tool>` at the first `__` after `mcp__`, so
 * `my__srv` is recorded as `my`, `srv_` (tool `mcp__srv___t`) as `srv`, and a
 * name starting with `__` as the empty string. Matching on the same split errs
 * toward "used", never toward removing a live server.
 */
export function recordedMcpPrefix(toolPrefix: string): string {
  const full = `${toolPrefix}__tool`;
  return full.slice(0, full.indexOf('__'));
}

/**
 * User- and local-scope MCP servers whose tools were never called in the
 * lookback window. Project servers live in a repo's committed `.mcp.json` and
 * are the team's to remove; managed and plugin servers are not the user's to
 * remove here (plugins are covered by `unused_plugin`).
 *
 * The token figure is an estimate: with tool search on (the default) only tool
 * names load at startup, and the tool count is unknown without connecting.
 */
const unusedMcpDetector: Detector = {
  name: 'unused_mcp',
  detect({
    mcpServers, recentMcpPrefixes, sessionsInWindow, totalUserCallableInvocations,
    lookbackDays, effectiveLookbackDays, mcpProjectKey, claudeJsonPath,
  }) {
    // Same global suppressions as unused_plugin.
    if (sessionsInWindow < 3) return [];
    if (totalUserCallableInvocations === 0) return [];

    const issues: Issue[] = [];
    for (const server of mcpServers) {
      if (server.scope !== 'user' && server.scope !== 'local') continue;
      if (server.status === 'blocked' || server.status === 'pending') continue;
      if (recentMcpPrefixes.has(server.toolPrefix)) continue;
      if (recentMcpPrefixes.has(recordedMcpPrefix(server.toolPrefix))) continue;
      issues.push({
        type: 'unused_mcp',
        tier: 3,
        name: server.name,
        mcpScope: server.scope,
        detail: `no tool called in ${usageWindowLabel(lookbackDays, effectiveLookbackDays)} (${server.scope} scope)`,
        tokens: MCP_SERVER_TOOLS_AVG * DEFERRED_TOOL_OVERHEAD_TOKENS,
        path: server.scope === 'local' ? mcpProjectKey : claudeJsonPath,
      });
    }
    return issues;
  },
};

const disabledPluginDetector: Detector = {
  name: 'disabled_plugin',
  detect({ plugins, disabledPlugins }) {
    const issues: Issue[] = [];
    for (const plugin of plugins) {
      // `disabledPlugins` holds `<plugin>@<marketplace>` identities.
      const marketplace = plugin.marketplace ?? plugin.name;
      if (!disabledPlugins.has(`${plugin.name}@${marketplace}`)) continue;
      issues.push({
        type: 'disabled_plugin',
        tier: 2,
        name: plugin.name,
        marketplace,
        detail: `${plugin.skillCount} skills, ${marketplace}`,
        tokens: plugin.skillCount * SKILL_PROMPT_OVERHEAD_TOKENS,
        path: plugin.name === marketplace
          ? join(getPluginsDir(), marketplace)
          : join(getPluginsDir(), marketplace, plugin.name),
      });
    }
    return issues;
  },
};

// The full registry. Order only matters for ties in the tier sort.
// New detectors: define above, add here, update CONTRIBUTING.md's issue-type table.

// Backup leftovers are the one cleanup hint that needs no usage signal: a name
// like `foo.bak.20260711` announces itself. Tier 2 rather than Tier 1 — a
// backup still has some value, so the user confirms rather than it being
// pre-selected. The move is reversible via `restore` like any other skill.
const backupArtifactDetector: Detector = {
  name: 'backup_artifact',
  detect({ localSkills }) {
    const issues: Issue[] = [];
    for (const skill of localSkills) {
      const match = detectBackupArtifact(skill.name);
      if (!match) continue;
      issues.push({
        type: 'backup_artifact',
        tier: 2,
        name: skill.name,
        detail: `looks like a backup copy (${match.label})`,
        tokens: skill.tokens,
        path: skill.path,
      });
    }
    return issues;
  },
};

export const detectors: Detector[] = [
  brokenSymlinkDetector,
  templateDetector,
  duplicateDetector,
  oversizedSkillDetector,
  skillDupDetector,
  tempCacheDetector,
  oversizedMemoryDetector,
  staleProjectDetector,
  unusedSkillDetector,
  unusedPluginDetector,
  unusedMcpDetector,
  disabledPluginDetector,
  backupArtifactDetector,
];

export function classifyIssues(
  ctx: DetectorContext,
  registry: Detector[] = detectors,
): Issue[] {
  const issues = registry.flatMap((d) => d.detect(ctx));
  issues.sort((a, b) => a.tier - b.tier);
  return issues;
}
