import { join } from 'node:path';
import { getPluginsDir } from '../paths.js';
import type { SkillInfo, BrokenSymlink, MemoryFile, PluginInfo, Issue } from '../types.js';
import type { TempCache } from './plugin-skills.js';
import type { StaleProject } from './memory.js';
import type { PluginSurfaces } from './plugin-surfaces.js';
import {
  OVERSIZED_SKILL_BYTES, OVERSIZED_MEMORY_BYTES, SKILL_PROMPT_OVERHEAD_TOKENS,
} from './constants.js';

// Everything a detector needs — threaded explicitly through context instead of
// relying on module-global state, so detectors are pure functions of their input.
export interface DetectorContext {
  localSkills: SkillInfo[];
  pluginSkills: SkillInfo[];
  brokenSymlinks: BrokenSymlink[];
  memoryFiles: MemoryFile[];
  tempCaches: TempCache[];
  staleProjects: StaleProject[];
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
  // v2.6 unused_plugin detector fields
  pluginSurfaces: PluginSurfaces[];
  enabledPlugins: Array<{ name: string; marketplace: string }>;
  recentMcpPrefixes: Set<string>;
  recentCommands: Set<string>;
  totalUserCallableInvocations: number;
  sessionsInWindow: number;
  // Per-plugin estimated token cost keyed by plugin name. Populated from
  // computePluginCosts(); used by unused_plugin to report accurate savings.
  pluginCosts: Map<string, number>;
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

const oversizedMemoryDetector: Detector = {
  name: 'oversized_memory',
  detect({ memoryFiles }) {
    const issues: Issue[] = [];
    for (const mem of memoryFiles) {
      if (mem.sizeBytes > OVERSIZED_MEMORY_BYTES) {
        issues.push({
          type: 'oversized_memory',
          tier: 2,
          name: `${mem.project}/${mem.name}`,
          detail: `${Math.round(mem.sizeBytes / 1024)}KB`,
          tokens: mem.tokens,
          path: mem.path,
        });
      }
    }
    return issues;
  },
};

const staleProjectDetector: Detector = {
  name: 'stale_project',
  detect({ staleProjects, memoryFiles }) {
    return staleProjects.map((stale) => {
      const memTokens = memoryFiles
        .filter((m) => m.project === stale.project)
        .reduce((sum, m) => sum + m.tokens, 0);
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
    sessionDataAvailable,
    lookbackDays,
  }) {
    // Suppress entirely when the data source is unreliable — better no signal
    // than a wrong one that flags every skill as unused.
    if (!sessionDataAvailable) return [];

    const issues: Issue[] = [];
    for (const skill of localSkills) {
      // Direct hit: invocation set contains the skill name as-is.
      if (recentSkillInvocations.has(skill.name)) continue;
      // Nested skill (e.g. "org/ship"): also check the bare leaf name, which
      // is how it would appear in a Skill tool_use input.
      if (skill.name.includes('/')) {
        const leaf = skill.name.split('/').pop()!;
        if (recentSkillInvocations.has(leaf)) continue;
      }
      issues.push({
        type: 'unused_skill',
        tier: 3,
        name: skill.name,
        detail: `not invoked in ${lookbackDays}d`,
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
    totalUserCallableInvocations,
    sessionsInWindow,
    lookbackDays,
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

      // Usage check: any skill/mcp/command from this plugin invoked?
      const usedSkill = ps.skills.some(
        (s) =>
          recentSkillInvocations.has(s) ||
          recentSkillInvocations.has(`${ps.pluginName}:${s}`),
      );
      const usedMcp = ps.mcpToolPrefixes.some((p) => recentMcpPrefixes.has(p));
      const usedCmd = ps.commands.some((c) => recentCommands.has(c));

      if (usedSkill || usedMcp || usedCmd) continue;

      issues.push({
        type: 'unused_plugin',
        tier: 3,
        name: ps.pluginName,
        marketplace: ps.marketplace,
        detail: `not invoked in ${lookbackDays}d (${ps.marketplace})`,
        tokens: pluginCosts.get(ps.pluginName) ?? 0,
        path: ps.installDir,
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
      if (disabledPlugins.has(plugin.name)) {
        issues.push({
          type: 'disabled_plugin',
          tier: 2,
          name: plugin.name,
          detail: `${plugin.skillCount} skills`,
          tokens: plugin.skillCount * SKILL_PROMPT_OVERHEAD_TOKENS,
          path: join(getPluginsDir(), plugin.name),
        });
      }
    }
    return issues;
  },
};

// The full registry. Order only matters for ties in the tier sort.
// New detectors: define above, add here, update CONTRIBUTING.md's issue-type table.
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
  disabledPluginDetector,
];

export function classifyIssues(
  ctx: DetectorContext,
  registry: Detector[] = detectors,
): Issue[] {
  const issues = registry.flatMap((d) => d.detect(ctx));
  issues.sort((a, b) => a.tier - b.tier);
  return issues;
}
