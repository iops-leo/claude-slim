import { describe, it, expect } from 'vitest';
import { detectors, type DetectorContext } from '../scanner/detectors.js';
import type { PluginSurfaces } from '../scanner/plugin-surfaces.js';

const unusedPluginDetector = detectors.find((d) => d.name === 'unused_plugin')!;

// Timestamp helpers
const NOW = Date.now();
const DAYS = (n: number) => n * 86400000;

function makePs(override: Partial<PluginSurfaces> = {}): PluginSurfaces {
  return {
    pluginName: 'test-plugin',
    marketplace: 'npmjs.com',
    version: '1.0.0',
    installDir: '/home/.claude/plugins/npmjs.com/test-plugin/1.0.0',
    installedAt: NOW - DAYS(90), // installed 90 days ago — before lookback window
    skills: ['my-skill'],
    mcpServerKeys: [],
    mcpToolPrefixes: [],
    commands: [],
    agentCount: 0,
    hookCount: 0,
    ...override,
  };
}

function makeCtx(partial: Partial<DetectorContext> = {}): DetectorContext {
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
    recentSkillInvocations: new Set(),
    sessionDataAvailable: true,
    lookbackDays: 60,
    pluginSurfaces: [],
    enabledPlugins: [],
    recentMcpPrefixes: new Set(),
    recentCommands: new Set(),
    totalUserCallableInvocations: 10,
    sessionsInWindow: 5,
    ...partial,
  };
}

describe('unused_plugin detector', () => {
  it('1. happy path — flags plugin with no invocations in lookback window', () => {
    const ps = makePs();
    const ctx = makeCtx({
      pluginSurfaces: [ps],
      enabledPlugins: [{ name: 'test-plugin', marketplace: 'npmjs.com' }],
      recentSkillInvocations: new Set(),
      recentMcpPrefixes: new Set(),
      recentCommands: new Set(),
      totalUserCallableInvocations: 10,
      sessionsInWindow: 5,
    });
    const issues = unusedPluginDetector.detect(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('unused_plugin');
    expect(issues[0].name).toBe('test-plugin');
    expect(issues[0].tier).toBe(3);
    expect(issues[0].path).toBe(ps.installDir);
  });

  it('2. suppression (a) — fewer than 3 sessions in window → empty result', () => {
    const ps = makePs();
    const ctx = makeCtx({
      pluginSurfaces: [ps],
      enabledPlugins: [{ name: 'test-plugin', marketplace: 'npmjs.com' }],
      totalUserCallableInvocations: 10,
      sessionsInWindow: 2,
    });
    expect(unusedPluginDetector.detect(ctx)).toEqual([]);
  });

  it('3. suppression (b) — zero totalUserCallableInvocations → empty result', () => {
    const ps = makePs();
    const ctx = makeCtx({
      pluginSurfaces: [ps],
      enabledPlugins: [{ name: 'test-plugin', marketplace: 'npmjs.com' }],
      totalUserCallableInvocations: 0,
      sessionsInWindow: 5,
    });
    expect(unusedPluginDetector.detect(ctx)).toEqual([]);
  });

  it('4. suppression (c) — plugin has no user-callable surface (agent/hook only)', () => {
    const ps = makePs({
      skills: [],
      mcpToolPrefixes: [],
      commands: [],
      agentCount: 2,
      hookCount: 1,
    });
    const ctx = makeCtx({
      pluginSurfaces: [ps],
      enabledPlugins: [{ name: 'test-plugin', marketplace: 'npmjs.com' }],
      totalUserCallableInvocations: 10,
      sessionsInWindow: 5,
    });
    expect(unusedPluginDetector.detect(ctx)).toEqual([]);
  });

  // (d) install-mtime suppression was dropped: cache mtime gets reset by
  // `claude plugin update`, so install date is not a reliable freshness signal.
  // Tier 3 (Optional) ensures users review any flagged plugin before disabling.

  it('6. inner join — plugin in surfaces but NOT in enabledPlugins is ignored', () => {
    const ps = makePs({ pluginName: '.git' }); // noise entry
    const ctx = makeCtx({
      pluginSurfaces: [ps],
      enabledPlugins: [], // empty — inner join fails for .git
      totalUserCallableInvocations: 10,
      sessionsInWindow: 5,
    });
    expect(unusedPluginDetector.detect(ctx)).toEqual([]);
  });

  it('7. used plugin is NOT flagged — skill invoked', () => {
    const ps = makePs({ skills: ['my-skill'] });
    const ctx = makeCtx({
      pluginSurfaces: [ps],
      enabledPlugins: [{ name: 'test-plugin', marketplace: 'npmjs.com' }],
      recentSkillInvocations: new Set(['my-skill']),
      totalUserCallableInvocations: 10,
      sessionsInWindow: 5,
    });
    expect(unusedPluginDetector.detect(ctx)).toEqual([]);
  });

  it('7b. used plugin is NOT flagged — mcp prefix invoked', () => {
    const ps = makePs({
      skills: [],
      mcpToolPrefixes: ['plugin_test-plugin_server'],
    });
    const ctx = makeCtx({
      pluginSurfaces: [ps],
      enabledPlugins: [{ name: 'test-plugin', marketplace: 'npmjs.com' }],
      recentMcpPrefixes: new Set(['plugin_test-plugin_server']),
      totalUserCallableInvocations: 10,
      sessionsInWindow: 5,
    });
    expect(unusedPluginDetector.detect(ctx)).toEqual([]);
  });

  it('8. namespaced skill — invocation as "<plugin>:<skill>" matches bare skill name', () => {
    // Transcript records `superpowers:tdd` — plugin surface has `tdd` in skills list
    const ps = makePs({
      pluginName: 'superpowers',
      skills: ['tdd'],
    });
    const ctx = makeCtx({
      pluginSurfaces: [ps],
      enabledPlugins: [{ name: 'superpowers', marketplace: 'npmjs.com' }],
      recentSkillInvocations: new Set(['superpowers:tdd']),
      totalUserCallableInvocations: 10,
      sessionsInWindow: 5,
    });
    // `superpowers:tdd` matches `tdd` in plugin `superpowers` → not unused
    expect(unusedPluginDetector.detect(ctx)).toEqual([]);
  });
});
