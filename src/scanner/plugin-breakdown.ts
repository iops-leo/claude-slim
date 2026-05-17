import type { PluginBreakdown } from '../types.js';
import type { PluginSurfaces } from './plugin-surfaces.js';
import type { InstalledPlugin } from './disabled-plugins.js';
import type { ClaudeMdSection } from './plugin-cost.js';
import { computePluginCosts } from './plugin-cost.js';

export interface PluginBreakdownOptions {
  surfaces: PluginSurfaces[];
  installedPlugins: InstalledPlugin[];
  invokedSkills: Set<string>;
  mcpPrefixesInvoked: Set<string>;
  commandsInvoked: Set<string>;
  totalUserCallableInvocations: number;
  sessionsInWindow: number;
  claudeMdSections: ClaudeMdSection[];
}

const MIN_SESSIONS = 3;

function classifyStatus(opts: {
  surface: PluginSurfaces | undefined;
  enabled: boolean;
  invokedSkills: Set<string>;
  mcpPrefixesInvoked: Set<string>;
  commandsInvoked: Set<string>;
  totalUserCallableInvocations: number;
  sessionsInWindow: number;
}): PluginBreakdown['status'] {
  const { surface, enabled, invokedSkills, mcpPrefixesInvoked, commandsInvoked,
    totalUserCallableInvocations, sessionsInWindow } = opts;

  if (!enabled) return 'disabled';

  if (!surface) return 'insufficient data';

  const userCallableSurfaces =
    surface.skills.length + surface.mcpServerKeys.length + surface.commands.length;

  if (userCallableSurfaces === 0) return 'agent-only';

  // Suppression: not enough session data
  if (sessionsInWindow < MIN_SESSIONS || totalUserCallableInvocations === 0) {
    return 'insufficient data';
  }

  // Check if any surface was actually invoked
  const skillUsed = surface.skills.some((s) => {
    // Skills may be invoked as <pluginName>:<skillName> or just <skillName>
    return (
      invokedSkills.has(`${surface.pluginName}:${s}`) ||
      invokedSkills.has(s)
    );
  });
  const mcpUsed = surface.mcpToolPrefixes.some((p) => mcpPrefixesInvoked.has(p));
  const cmdUsed = surface.commands.some((c) => commandsInvoked.has(c));

  if (skillUsed || mcpUsed || cmdUsed) return 'used';
  return 'unused';
}

export function computePluginBreakdown(opts: PluginBreakdownOptions): PluginBreakdown[] {
  const {
    surfaces, installedPlugins, invokedSkills, mcpPrefixesInvoked,
    commandsInvoked, totalUserCallableInvocations, sessionsInWindow, claudeMdSections,
  } = opts;

  // Build map: pluginName → surface
  const surfaceMap = new Map<string, PluginSurfaces>();
  for (const s of surfaces) {
    // Prefer the most recently installed version (largest installedAt)
    const existing = surfaceMap.get(s.pluginName);
    if (!existing || s.installedAt > existing.installedAt) {
      surfaceMap.set(s.pluginName, s);
    }
  }

  // Build cost map: pluginName → tokens
  const costs = computePluginCosts(surfaces, claudeMdSections);
  const costMap = new Map<string, number>();
  for (const c of costs) {
    const existing = costMap.get(c.pluginName) ?? 0;
    costMap.set(c.pluginName, existing + c.totalEstimatedTokens);
  }

  // Collect all unique plugin names from both installed list and surfaces.
  // Skip noise from failed plugin installs: cache dirs like `temp_git_*` get
  // walked as if they were marketplaces, surfacing `.git/{hooks,info,...}` as
  // fake "plugins". The temp_cache detector already flags these for cleanup.
  const isNoise = (pluginName: string, marketplace: string): boolean =>
    pluginName === '.git' || marketplace.startsWith('temp_git_');

  const allNames = new Set<string>();
  for (const p of installedPlugins) {
    if (!isNoise(p.name, p.marketplace)) allNames.add(p.name);
  }
  for (const s of surfaces) {
    if (!isNoise(s.pluginName, s.marketplace)) allNames.add(s.pluginName);
  }

  const rows: PluginBreakdown[] = [];

  for (const name of allNames) {
    const installed = installedPlugins.find((p) => p.name === name);
    const enabled = installed ? installed.enabled : true; // surfaces not in list are treated as enabled
    const marketplace = installed?.marketplace ?? surfaceMap.get(name)?.marketplace ?? '';
    const surface = surfaceMap.get(name);

    const status = classifyStatus({
      surface,
      enabled,
      invokedSkills,
      mcpPrefixesInvoked,
      commandsInvoked,
      totalUserCallableInvocations,
      sessionsInWindow,
    });

    const lastUsed: PluginBreakdown['lastUsed'] = status === 'used' ? 'used' : 'never';

    rows.push({
      name,
      marketplace,
      tokens: costMap.get(name) ?? 0,
      skills: surface?.skills.length ?? 0,
      mcp: surface?.mcpServerKeys.length ?? 0,
      commands: surface?.commands.length ?? 0,
      lastUsed,
      status,
    });
  }

  // Sort by tokens descending
  rows.sort((a, b) => b.tokens - a.tokens);

  return rows;
}

export function formatPluginsTable(
  rows: PluginBreakdown[],
  totalInstalled: number,
  totalEnabled: number,
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(
    `\x1b[1m  PLUGIN BREAKDOWN\x1b[0m (${totalInstalled} installed, ${totalEnabled} enabled)`,
  );

  if (rows.length === 0) {
    lines.push('    (none)');
    return lines.join('\n');
  }

  // Column widths: Plugin(30) ~Tokens(10) Skills(7) MCP(5) Cmd(5) Last used(11) Status(20)
  const COL_PLUGIN = 30;
  const COL_TOKENS = 10;
  const COL_SKILLS = 7;
  const COL_MCP = 5;
  const COL_CMD = 5;
  const COL_LAST = 11;
  // Status: flexible (rest of line)

  const rpad = (s: string, n: number) => s.padEnd(n);
  const lpad = (s: string, n: number) => s.padStart(n);

  const header =
    `    ${rpad('Plugin', COL_PLUGIN)}` +
    `${lpad('~Tokens', COL_TOKENS)}` +
    `${lpad('Skills', COL_SKILLS)}` +
    `${lpad('MCP', COL_MCP)}` +
    `${lpad('Cmd', COL_CMD)}` +
    `  ${'Last used'.padEnd(COL_LAST)}` +
    `Status`;

  lines.push(header);

  for (const row of rows) {
    const tokStr = row.tokens > 0 ? `~${row.tokens.toLocaleString()}` : '~?';
    const line =
      `    ${rpad(row.name, COL_PLUGIN)}` +
      `${lpad(tokStr, COL_TOKENS)}` +
      `${lpad(String(row.skills), COL_SKILLS)}` +
      `${lpad(String(row.mcp), COL_MCP)}` +
      `${lpad(String(row.commands), COL_CMD)}` +
      `  ${row.lastUsed.padEnd(COL_LAST)}` +
      `${row.status}`;
    lines.push(line);
  }

  return lines.join('\n');
}
