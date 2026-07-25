import { describe, it, expect } from 'vitest';
import {
  computePluginCosts,
  type PluginCostBreakdown,
} from '../scanner/plugin-cost.js';
import {
  SKILL_PROMPT_OVERHEAD_TOKENS,
  DEFERRED_TOOL_OVERHEAD_TOKENS,
  COMMAND_OVERHEAD_TOKENS,
  MCP_SERVER_TOOLS_AVG,
} from '../scanner/constants.js';
import type { PluginSurfaces } from '../scanner/plugin-surfaces.js';

function makeSurface(overrides: Partial<PluginSurfaces>): PluginSurfaces {
  return {
    pluginName: 'test-plugin',
    marketplace: 'test-market',
    version: '1.0.0',
    installDir: '/tmp/test',
    installedAt: 0,
    skills: [],
    skillListingTokens: 0,
    mcpServerKeys: [],
    mcpToolPrefixes: [],
    commands: [],
    agentCount: 0,
    hookCount: 0,
    ...overrides,
  };
}

describe('computePluginCosts', () => {
  it('case 1: empty plugin with no surfaces and no CLAUDE.md match → totalEstimatedTokens 0', () => {
    const surfaces = [makeSurface({ pluginName: 'empty-plugin' })];
    const results = computePluginCosts(surfaces, []);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.claudeMdTokens).toBe(0);
    expect(r.skillTokens).toBe(0);
    expect(r.mcpToolTokens).toBe(0);
    expect(r.commandTokens).toBe(0);
    expect(r.totalEstimatedTokens).toBe(0);
  });

  it('case 2: skills-only plugin → skillTokens passes through measured listing cost, rest 0', () => {
    const surfaces = [
      makeSurface({
        pluginName: 'skill-plugin',
        skills: ['skill-a', 'skill-b', 'skill-c'],
        skillListingTokens: SKILL_PROMPT_OVERHEAD_TOKENS * 3,
      }),
    ];
    const results = computePluginCosts(surfaces, []);
    const r = results[0];
    expect(r.skillTokens).toBe(SKILL_PROMPT_OVERHEAD_TOKENS * 3);
    expect(r.claudeMdTokens).toBe(0);
    expect(r.mcpToolTokens).toBe(0);
    expect(r.commandTokens).toBe(0);
    expect(r.totalEstimatedTokens).toBe(SKILL_PROMPT_OVERHEAD_TOKENS * 3);
  });

  it('case 3: all surfaces present → correct per-field calculation', () => {
    const surfaces = [
      makeSurface({
        pluginName: 'full-plugin',
        skills: ['s1', 's2'],
        skillListingTokens: SKILL_PROMPT_OVERHEAD_TOKENS * 2,
        mcpServerKeys: ['server1'],
        mcpToolPrefixes: ['plugin_full-plugin_server1'],
        commands: ['cmd1', 'cmd2', 'cmd3'],
      }),
    ];
    const results = computePluginCosts(surfaces, []);
    const r = results[0];
    const expectedSkill = SKILL_PROMPT_OVERHEAD_TOKENS * 2;
    const expectedMcp = DEFERRED_TOOL_OVERHEAD_TOKENS * MCP_SERVER_TOOLS_AVG * 1;
    const expectedCmd = COMMAND_OVERHEAD_TOKENS * 3;
    expect(r.skillTokens).toBe(expectedSkill);
    expect(r.mcpToolTokens).toBe(expectedMcp);
    expect(r.commandTokens).toBe(expectedCmd);
    expect(r.claudeMdTokens).toBe(0);
    expect(r.totalEstimatedTokens).toBe(expectedSkill + expectedMcp + expectedCmd);
  });

  it('case 4: CLAUDE.md section matches plugin name substring → claudeMdTokens added', () => {
    const surfaces = [
      makeSurface({ pluginName: 'oh-my-claudecode' }),
    ];
    const sections = [
      { name: 'oh-my-claudecode - Intelligent Multi-Agent Orchestration', sizeBytes: 1000, tokens: 500 },
      { name: 'Behavioral Defaults', sizeBytes: 200, tokens: 80 },
    ];
    const results = computePluginCosts(surfaces, sections);
    const r = results[0];
    expect(r.claudeMdTokens).toBe(500);
  });

  it('case 5: no CLAUDE.md section matches plugin name → claudeMdTokens 0', () => {
    const surfaces = [
      makeSurface({ pluginName: 'my-plugin' }),
    ];
    const sections = [
      { name: 'other-plugin section', sizeBytes: 300, tokens: 120 },
    ];
    const results = computePluginCosts(surfaces, sections);
    expect(results[0].claudeMdTokens).toBe(0);
  });

  it('case 6: totalEstimatedTokens equals sum of all component fields', () => {
    const surfaces = [
      makeSurface({
        pluginName: 'myplug',
        skills: ['x'],
        mcpServerKeys: ['s1', 's2'],
        commands: ['c1'],
      }),
    ];
    const sections = [
      { name: 'myplug configuration', sizeBytes: 400, tokens: 200 },
    ];
    const results = computePluginCosts(surfaces, sections);
    const r = results[0];
    const sum = r.claudeMdTokens + r.skillTokens + r.mcpToolTokens + r.commandTokens;
    expect(r.totalEstimatedTokens).toBe(sum);
  });

  it('metadata fields are carried through correctly', () => {
    const surfaces = [
      makeSurface({ pluginName: 'meta-plugin', marketplace: 'npmjs' }),
    ];
    const results = computePluginCosts(surfaces, []);
    expect(results[0].pluginName).toBe('meta-plugin');
    expect(results[0].marketplace).toBe('npmjs');
  });
});
