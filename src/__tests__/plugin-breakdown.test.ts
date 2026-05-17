import { describe, it, expect } from 'vitest';
import type { PluginBreakdown } from '../types.js';
import { computePluginBreakdown } from '../scanner/plugin-breakdown.js';
import type { PluginSurfaces } from '../scanner/plugin-surfaces.js';
import type { InstalledPlugin } from '../scanner/disabled-plugins.js';

function makePs(override: Partial<PluginSurfaces> = {}): PluginSurfaces {
  return {
    pluginName: 'test-plugin',
    marketplace: 'npmjs.com',
    version: '1.0.0',
    installDir: '/home/.claude/plugins/npmjs.com/test-plugin/1.0.0',
    installedAt: Date.now() - 90 * 86400000,
    skills: ['skill-a'],
    mcpServerKeys: [],
    mcpToolPrefixes: [],
    commands: [],
    agentCount: 0,
    hookCount: 0,
    ...override,
  };
}

function makeInstalled(name: string, marketplace = 'npmjs.com', enabled = true): InstalledPlugin {
  return { name, marketplace, enabled };
}

// ----- 1. empty environment -----
describe('computePluginBreakdown', () => {
  it('1. empty surfaces → empty result', () => {
    const result = computePluginBreakdown({
      surfaces: [],
      installedPlugins: [],
      invokedSkills: new Set(),
      mcpPrefixesInvoked: new Set(),
      commandsInvoked: new Set(),
      totalUserCallableInvocations: 0,
      sessionsInWindow: 0,
      claudeMdSections: [],
    });
    expect(result).toEqual([]);
  });

  // ----- 2. enabled + disabled mix -----
  it('2. disabled plugin gets status=disabled', () => {
    const ps = makePs({ pluginName: 'disabled-plugin' });
    const installed = [makeInstalled('disabled-plugin', 'npmjs.com', false)];
    const result = computePluginBreakdown({
      surfaces: [ps],
      installedPlugins: installed,
      invokedSkills: new Set(),
      mcpPrefixesInvoked: new Set(),
      commandsInvoked: new Set(),
      totalUserCallableInvocations: 10,
      sessionsInWindow: 5,
      claudeMdSections: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('disabled');
  });

  it('2b. enabled plugin with invocations gets status=used', () => {
    const ps = makePs({ pluginName: 'active-plugin', skills: ['my-skill'] });
    const installed = [makeInstalled('active-plugin')];
    const result = computePluginBreakdown({
      surfaces: [ps],
      installedPlugins: installed,
      invokedSkills: new Set(['active-plugin:my-skill']),
      mcpPrefixesInvoked: new Set(),
      commandsInvoked: new Set(),
      totalUserCallableInvocations: 10,
      sessionsInWindow: 5,
      claudeMdSections: [],
    });
    expect(result[0].status).toBe('used');
    expect(result[0].lastUsed).toBe('used');
  });

  // ----- 3. status classification -----
  it('3a. status=unused — has user-callable surfaces but no invocations', () => {
    const ps = makePs({ skills: ['s1'] });
    const installed = [makeInstalled('test-plugin')];
    const result = computePluginBreakdown({
      surfaces: [ps],
      installedPlugins: installed,
      invokedSkills: new Set(),
      mcpPrefixesInvoked: new Set(),
      commandsInvoked: new Set(),
      totalUserCallableInvocations: 10,
      sessionsInWindow: 5,
      claudeMdSections: [],
    });
    expect(result[0].status).toBe('unused');
  });

  it('3b. status=agent-only — no user-callable surfaces', () => {
    const ps = makePs({ skills: [], mcpServerKeys: [], commands: [], agentCount: 2 });
    const installed = [makeInstalled('test-plugin')];
    const result = computePluginBreakdown({
      surfaces: [ps],
      installedPlugins: installed,
      invokedSkills: new Set(),
      mcpPrefixesInvoked: new Set(),
      commandsInvoked: new Set(),
      totalUserCallableInvocations: 10,
      sessionsInWindow: 5,
      claudeMdSections: [],
    });
    expect(result[0].status).toBe('agent-only');
  });

  it('3c. status=insufficient data — sessionsInWindow < 3', () => {
    const ps = makePs({ skills: ['s1'] });
    const installed = [makeInstalled('test-plugin')];
    const result = computePluginBreakdown({
      surfaces: [ps],
      installedPlugins: installed,
      invokedSkills: new Set(),
      mcpPrefixesInvoked: new Set(),
      commandsInvoked: new Set(),
      totalUserCallableInvocations: 0,
      sessionsInWindow: 2,
      claudeMdSections: [],
    });
    expect(result[0].status).toBe('insufficient data');
  });

  it('3d. status=insufficient data — totalUserCallableInvocations === 0 (even with enough sessions)', () => {
    const ps = makePs({ skills: ['s1'] });
    const installed = [makeInstalled('test-plugin')];
    const result = computePluginBreakdown({
      surfaces: [ps],
      installedPlugins: installed,
      invokedSkills: new Set(),
      mcpPrefixesInvoked: new Set(),
      commandsInvoked: new Set(),
      totalUserCallableInvocations: 0,
      sessionsInWindow: 5,
      claudeMdSections: [],
    });
    expect(result[0].status).toBe('insufficient data');
  });

  // ----- 4. sorting by tokens descending -----
  it('4. sorted by tokens descending', () => {
    const surfaces: PluginSurfaces[] = [
      makePs({ pluginName: 'small', skills: [] }),
      makePs({ pluginName: 'large', skills: ['s1', 's2', 's3', 's4', 's5'] }),
      makePs({ pluginName: 'medium', skills: ['s1', 's2'] }),
    ];
    const installed = [
      makeInstalled('small'),
      makeInstalled('large'),
      makeInstalled('medium'),
    ];
    const result = computePluginBreakdown({
      surfaces,
      installedPlugins: installed,
      invokedSkills: new Set(),
      mcpPrefixesInvoked: new Set(),
      commandsInvoked: new Set(),
      totalUserCallableInvocations: 10,
      sessionsInWindow: 5,
      claudeMdSections: [],
    });
    const names = result.map((r) => r.name);
    expect(names[0]).toBe('large');
    expect(names[1]).toBe('medium');
    expect(names[2]).toBe('small');
  });

  // ----- 5. correct column values -----
  it('5. columns populated correctly', () => {
    const ps = makePs({
      pluginName: 'my-plugin',
      skills: ['s1', 's2'],
      mcpServerKeys: ['server1'],
      mcpToolPrefixes: ['plugin_my-plugin_server1'],
      commands: ['cmd1', 'cmd2', 'cmd3'],
    });
    const installed = [makeInstalled('my-plugin')];
    const result = computePluginBreakdown({
      surfaces: [ps],
      installedPlugins: installed,
      invokedSkills: new Set(),
      mcpPrefixesInvoked: new Set(),
      commandsInvoked: new Set(),
      totalUserCallableInvocations: 10,
      sessionsInWindow: 5,
      claudeMdSections: [],
    });
    expect(result[0].name).toBe('my-plugin');
    expect(result[0].skills).toBe(2);
    expect(result[0].mcp).toBe(1);
    expect(result[0].commands).toBe(3);
    expect(result[0].tokens).toBeGreaterThan(0);
  });

  // ----- 6. MCP prefix matching for used status -----
  it('6. plugin with invoked MCP prefix → status=used', () => {
    const ps = makePs({
      pluginName: 'mcp-plugin',
      skills: [],
      mcpServerKeys: ['t'],
      mcpToolPrefixes: ['plugin_mcp-plugin_t'],
    });
    const installed = [makeInstalled('mcp-plugin')];
    const result = computePluginBreakdown({
      surfaces: [ps],
      installedPlugins: installed,
      invokedSkills: new Set(),
      mcpPrefixesInvoked: new Set(['plugin_mcp-plugin_t']),
      commandsInvoked: new Set(),
      totalUserCallableInvocations: 10,
      sessionsInWindow: 5,
      claudeMdSections: [],
    });
    expect(result[0].status).toBe('used');
  });

  // ----- 7. installed-but-no-surfaces plugin from disabled list -----
  it('7. installed disabled plugin not in surfaces → still appears with zeros', () => {
    const installed = [makeInstalled('ghost-plugin', 'npmjs.com', false)];
    const result = computePluginBreakdown({
      surfaces: [],
      installedPlugins: installed,
      invokedSkills: new Set(),
      mcpPrefixesInvoked: new Set(),
      commandsInvoked: new Set(),
      totalUserCallableInvocations: 0,
      sessionsInWindow: 0,
      claudeMdSections: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('ghost-plugin');
    expect(result[0].status).toBe('disabled');
    expect(result[0].tokens).toBe(0);
  });
});

// ----- 8. formatPluginsTable -----
describe('formatPluginsTable', () => {
  it('8. renders header and rows with correct columns', async () => {
    const { formatPluginsTable } = await import('../scanner/plugin-breakdown.js');
    const rows: PluginBreakdown[] = [
      {
        name: 'my-plugin',
        marketplace: 'npmjs.com',
        tokens: 6113,
        skills: 36,
        mcp: 2,
        commands: 0,
        lastUsed: 'used',
        status: 'used',
      },
      {
        name: 'small-plugin',
        marketplace: 'npmjs.com',
        tokens: 0,
        skills: 0,
        mcp: 0,
        commands: 2,
        lastUsed: 'never',
        status: 'unused',
      },
    ];
    const totalInstalled = 5;
    const totalEnabled = 4;
    const out = formatPluginsTable(rows, totalInstalled, totalEnabled);
    expect(out).toContain('PLUGIN BREAKDOWN');
    expect(out).toContain('5 installed');
    expect(out).toContain('4 enabled');
    expect(out).toContain('my-plugin');
    expect(out).toContain('~6,113');
    expect(out).toContain('used');
    expect(out).toContain('small-plugin');
    expect(out).toContain('unused');
    // header columns
    expect(out).toContain('~Tokens');
    expect(out).toContain('Skills');
    expect(out).toContain('Status');
  });
});
