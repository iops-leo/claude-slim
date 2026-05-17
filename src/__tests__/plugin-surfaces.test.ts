import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createTmpClaude } from './helpers/tmp-claude.js';
import type { TmpClaude } from './helpers/tmp-claude.js';
import { scanPluginSurfaces } from '../scanner/plugin-surfaces.js';

// Helper: create a plugin directory under pluginsDir/<marketplace>/<plugin>/<version>/
async function makePluginDir(
  pluginsDir: string,
  marketplace: string,
  plugin: string,
  version = '1.0.0',
): Promise<string> {
  const dir = join(pluginsDir, marketplace, plugin, version);
  await mkdir(dir, { recursive: true });
  return dir;
}

let tmp: TmpClaude;

afterEach(async () => {
  if (tmp) await tmp.cleanup();
});

describe('scanPluginSurfaces', () => {
  it('skill-only plugin: skills filled, mcp and commands empty', async () => {
    tmp = await createTmpClaude();
    const pluginDir = await makePluginDir(tmp.pluginsDir, 'omc', 'my-plugin', '1.0.0');

    // Add one skill
    await mkdir(join(pluginDir, 'skills', 'my-skill'), { recursive: true });
    await writeFile(join(pluginDir, 'skills', 'my-skill', 'SKILL.md'), '# My Skill');

    const results = await scanPluginSurfaces();
    expect(results).toHaveLength(1);
    const ps = results[0];
    expect(ps.pluginName).toBe('my-plugin');
    expect(ps.marketplace).toBe('omc');
    expect(ps.version).toBe('1.0.0');
    expect(ps.skills).toEqual(['my-skill']);
    expect(ps.mcpServerKeys).toEqual([]);
    expect(ps.mcpToolPrefixes).toEqual([]);
    expect(ps.commands).toEqual([]);
  });

  it('mcp-only plugin: mcpServerKeys and mcpToolPrefixes filled', async () => {
    tmp = await createTmpClaude();
    const pluginDir = await makePluginDir(tmp.pluginsDir, 'omc', 'mcp-plugin', '2.0.0');

    await writeFile(
      join(pluginDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { myServer: {}, anotherServer: {} } }),
    );

    const results = await scanPluginSurfaces();
    expect(results).toHaveLength(1);
    const ps = results[0];
    expect(ps.skills).toEqual([]);
    expect(ps.mcpServerKeys.sort()).toEqual(['anotherServer', 'myServer']);
    expect(ps.mcpToolPrefixes.sort()).toEqual([
      'plugin_mcp-plugin_anotherServer',
      'plugin_mcp-plugin_myServer',
    ]);
    expect(ps.commands).toEqual([]);
  });

  it('mixed plugin: skills + mcp + commands all filled', async () => {
    tmp = await createTmpClaude();
    const pluginDir = await makePluginDir(tmp.pluginsDir, 'market', 'mixed-plugin', '3.0.0');

    // skill
    await mkdir(join(pluginDir, 'skills', 'cool-skill'), { recursive: true });
    await writeFile(join(pluginDir, 'skills', 'cool-skill', 'SKILL.md'), '# Cool');

    // mcp
    await writeFile(
      join(pluginDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { toolServer: {} } }),
    );

    // command
    await mkdir(join(pluginDir, 'commands'), { recursive: true });
    await writeFile(join(pluginDir, 'commands', 'do-thing.md'), '# Do Thing');

    const results = await scanPluginSurfaces();
    expect(results).toHaveLength(1);
    const ps = results[0];
    expect(ps.skills).toEqual(['cool-skill']);
    expect(ps.mcpServerKeys).toEqual(['toolServer']);
    expect(ps.mcpToolPrefixes).toEqual(['plugin_mixed-plugin_toolServer']);
    expect(ps.commands).toEqual(['do-thing']);
  });

  it('malformed .mcp.json: silent skip, mcpServerKeys = []', async () => {
    tmp = await createTmpClaude();
    const pluginDir = await makePluginDir(tmp.pluginsDir, 'omc', 'bad-mcp', '1.0.0');

    await writeFile(join(pluginDir, '.mcp.json'), 'NOT VALID JSON {{{');

    const results = await scanPluginSurfaces();
    expect(results).toHaveLength(1);
    expect(results[0].mcpServerKeys).toEqual([]);
    expect(results[0].mcpToolPrefixes).toEqual([]);
  });

  it('agents/hooks only: agentCount and hookCount > 0, user-callable arrays empty', async () => {
    tmp = await createTmpClaude();
    const pluginDir = await makePluginDir(tmp.pluginsDir, 'omc', 'infra-plugin', '1.0.0');

    await mkdir(join(pluginDir, 'agents'), { recursive: true });
    await writeFile(join(pluginDir, 'agents', 'worker.md'), '# Worker');
    await writeFile(join(pluginDir, 'agents', 'planner.md'), '# Planner');

    await mkdir(join(pluginDir, 'hooks'), { recursive: true });
    await writeFile(join(pluginDir, 'hooks', 'post-tool.sh'), '#!/bin/sh');

    const results = await scanPluginSurfaces();
    expect(results).toHaveLength(1);
    const ps = results[0];
    expect(ps.agentCount).toBe(2);
    expect(ps.hookCount).toBe(1);
    expect(ps.skills).toEqual([]);
    expect(ps.mcpServerKeys).toEqual([]);
    expect(ps.commands).toEqual([]);
  });

  it('mcpToolPrefixes format: plugin_<plugin>_<serverKey>', async () => {
    tmp = await createTmpClaude();
    const pluginDir = await makePluginDir(tmp.pluginsDir, 'mkt', 'my-tool', '1.0.0');

    await writeFile(
      join(pluginDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { alpha: {}, beta: {} } }),
    );

    const results = await scanPluginSurfaces();
    expect(results).toHaveLength(1);
    for (const prefix of results[0].mcpToolPrefixes) {
      expect(prefix).toMatch(/^plugin_my-tool_[a-zA-Z]+$/);
    }
    expect(results[0].mcpToolPrefixes).toContain('plugin_my-tool_alpha');
    expect(results[0].mcpToolPrefixes).toContain('plugin_my-tool_beta');
  });
});
