import { runCommand } from './fs-walk.js';

/** `<plugin>@<marketplace>` — the unit Claude Code enables and disables. */
export function pluginIdentity(plugin: string, marketplace: string): string {
  return `${plugin}@${marketplace}`;
}

/**
 * Plugins `claude plugin list` reports disabled, as `<plugin>@<marketplace>`.
 *
 * Per plugin, not per marketplace: collapsing to the marketplace (pre-2.17)
 * marked every plugin from it disabled as soon as one was. The list has one
 * row per scope, so an identity enabled in any scope counts as enabled.
 */
export function parseDisabledPlugins(output: string): Set<string> {
  const rows = parseInstalledPlugins(output);
  const enabled = new Set(rows.filter((p) => p.enabled).map((p) => pluginIdentity(p.name, p.marketplace)));
  return new Set(
    rows
      .filter((p) => !p.enabled)
      .map((p) => pluginIdentity(p.name, p.marketplace))
      .filter((id) => !enabled.has(id)),
  );
}

export async function getDisabledPlugins(): Promise<Set<string>> {
  return parseDisabledPlugins(await runCommand('claude', ['plugin', 'list']));
}

export interface InstalledPlugin {
  name: string;        // plugin name (left of @)
  marketplace: string; // marketplace name (right of @)
  enabled: boolean;
}

// Parse `claude plugin list` output into per-plugin entries, preserving the
// full <plugin>@<marketplace> pair.
export function parseInstalledPlugins(output: string): InstalledPlugin[] {
  const plugins: InstalledPlugin[] = [];
  if (!output) return plugins;

  let current: { name: string; marketplace: string } | null = null;

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('❯')) {
      const full = trimmed.split('❯')[1]?.trim() || '';
      const at = full.indexOf('@');
      if (at > 0) {
        current = { name: full.slice(0, at), marketplace: full.slice(at + 1) };
      } else if (full) {
        current = { name: full, marketplace: full };
      } else {
        current = null;
      }
    } else if (current && trimmed.toLowerCase().includes('disabled')) {
      plugins.push({ ...current, enabled: false });
      current = null;
    } else if (current && trimmed.toLowerCase().includes('enabled')) {
      plugins.push({ ...current, enabled: true });
      current = null;
    }
  }

  return plugins;
}

export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  return parseInstalledPlugins(await runCommand('claude', ['plugin', 'list']));
}
