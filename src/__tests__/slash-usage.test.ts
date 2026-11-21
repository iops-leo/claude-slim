import { describe, it, expect } from 'vitest';
import { detectors, type DetectorContext } from '../scanner/detectors.js';
import { computePluginBreakdown } from '../scanner/plugin-breakdown.js';
import type { PluginSurfaces } from '../scanner/plugin-surfaces.js';
import type { SkillInfo } from '../types.js';

/**
 * Typing `/daily` logs `<command-name>/daily</command-name>` and no Skill
 * tool_use. Usage detection that only reads Skill calls reported every
 * slash-invoked skill — and every plugin used only through `/plugin:cmd` —
 * as unused.
 */

const unusedSkill = detectors.find((d) => d.name === 'unused_skill')!;
const unusedPlugin = detectors.find((d) => d.name === 'unused_plugin')!;

function skill(name: string): SkillInfo {
  return { name, path: `/h/.claude/skills/${name}`, sizeBytes: 10, tokens: 5, listingTokens: 5, source: 'local' };
}

function ps(override: Partial<PluginSurfaces> = {}): PluginSurfaces {
  return {
    pluginName: 'myplug',
    marketplace: 'mkt',
    version: '1.0.0',
    installDir: '/h/.claude/plugins/cache/mkt/myplug/1.0.0',
    installedAt: 0,
    skills: [],
    skillListingTokens: 0,
    mcpServerKeys: [],
    mcpToolPrefixes: [],
    commands: [],
    agentCount: 0,
    hookCount: 0,
    ...override,
  };
}

function ctx(partial: Partial<DetectorContext>): DetectorContext {
  return {
    localSkills: [],
    pluginSkills: [],
    brokenSymlinks: [],
    memoryFiles: [],
    tempCaches: [],
    staleProjects: [],
    disabledPlugins: new Set(),
    plugins: [],
    contents: new Map(),
    recentSkillInvocations: new Set(['something-else']),
    sessionDataAvailable: true,
    lookbackDays: 60,
    pluginSurfaces: [],
    enabledPlugins: [{ name: 'myplug', marketplace: 'mkt' }],
    recentMcpPrefixes: new Set(),
    recentCommands: new Set(),
    totalUserCallableInvocations: 10,
    sessionsInWindow: 5,
    pluginCosts: new Map(),
    mcpServers: [],
    mcpProjectKey: '',
    claudeJsonPath: '',
    ...partial,
  };
}

describe('unused_skill — slash invocations count as use', () => {
  it('does not flag a skill invoked only as /daily', () => {
    const issues = unusedSkill.detect(ctx({
      localSkills: [skill('daily'), skill('idle')],
      recentCommands: new Set(['daily']),
    }));
    expect(issues.map((i) => i.name)).toEqual(['idle']);
  });

  it('matches a nested skill by its slash forms', () => {
    const issues = unusedSkill.detect(ctx({
      localSkills: [skill('org/ship'), skill('apps/web/deploy'), skill('team/notes')],
      recentCommands: new Set(['org:ship', 'apps/web:deploy']),
    }));
    expect(issues.map((i) => i.name)).toEqual(['team/notes']);
  });

  it('matches a nested skill when the command names it with its slash path', () => {
    const issues = unusedSkill.detect(ctx({
      localSkills: [skill('org/ship')],
      recentCommands: new Set(['org/ship']),
    }));
    expect(issues).toEqual([]);
  });
});

describe('unused_plugin — namespaced slash invocations count as use', () => {
  it('counts /myplug:cmd against a command stored bare', () => {
    const issues = unusedPlugin.detect(ctx({
      pluginSurfaces: [ps({ commands: ['bar-myplug'] })],
      recentCommands: new Set(['myplug:bar-myplug']),
    }));
    expect(issues).toEqual([]);
  });

  it('counts /myplug:skill (slash-invoked plugin skill)', () => {
    const issues = unusedPlugin.detect(ctx({
      pluginSurfaces: [ps({ skills: ['s-myplug'] })],
      recentCommands: new Set(['myplug:s-myplug']),
    }));
    expect(issues).toEqual([]);
  });

  it('still flags a plugin whose surfaces were never invoked', () => {
    const issues = unusedPlugin.detect(ctx({
      pluginSurfaces: [ps({ skills: ['s-myplug'], commands: ['bar-myplug'] })],
      recentCommands: new Set(['otherplug:bar-myplug']),
    }));
    expect(issues.map((i) => i.name)).toEqual(['myplug']);
  });
});

describe('PLUGIN BREAKDOWN — used column matches namespaced slash invocations', () => {
  const base = {
    installedPlugins: [{ name: 'myplug', marketplace: 'mkt', enabled: true }],
    invokedSkills: new Set<string>(),
    mcpPrefixesInvoked: new Set<string>(),
    totalUserCallableInvocations: 10,
    sessionsInWindow: 5,
    claudeMdSections: [],
  };

  it('marks a plugin used via /myplug:cmd as used', () => {
    const [row] = computePluginBreakdown({
      ...base,
      surfaces: [ps({ commands: ['bar-myplug'] })],
      commandsInvoked: new Set(['myplug:bar-myplug']),
    });
    expect(row.status).toBe('used');
  });

  it('marks a plugin used via /myplug:skill as used', () => {
    const [row] = computePluginBreakdown({
      ...base,
      surfaces: [ps({ skills: ['s-myplug'] })],
      commandsInvoked: new Set(['myplug:s-myplug']),
    });
    expect(row.status).toBe('used');
  });
});
