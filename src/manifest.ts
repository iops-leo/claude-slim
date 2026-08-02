import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import type { Manifest, ManifestEntry, AnyManifestEntry, DisabledPluginEntry } from './types.js';
import {
  getDisabledDir as getDir,
  getAgentDisabledDir,
  getManifestPath,
  getLegacyManifestPath,
} from './paths.js';
import type { AgentId } from './paths.js';

export function getDisabledDir(): string {
  return getDir();
}

/** Create (if needed) and return the disabled-skill store for one agent. */
export async function ensureDisabledDir(agent: AgentId = 'claude'): Promise<string> {
  const dir = getAgentDisabledDir(agent);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Legacy JSONL format included an `action?: 'restored'` field that v2 no longer
// carries. We only reference it during migration, so model it as a local type.
type LegacyJsonlEntry = ManifestEntry & { action?: 'restored' };

function isDisabledPluginEntry(e: AnyManifestEntry): e is DisabledPluginEntry {
  return e.type === 'disabled_plugin' && 'plugin' in e && 'marketplace' in e;
}

function parseJsonl(content: string): LegacyJsonlEntry[] {
  const entries: LegacyJsonlEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // Skip corrupted lines
    }
  }
  return entries;
}

function collapseLegacy(entries: LegacyJsonlEntry[]): ManifestEntry[] {
  // Group by name. If the latest entry for a name has action='restored',
  // the item was restored and is excluded. Otherwise keep the first
  // (earliest clean record) as the canonical entry.
  const byName = new Map<string, LegacyJsonlEntry[]>();
  for (const e of entries) {
    const list = byName.get(e.name) ?? [];
    list.push(e);
    byName.set(e.name, list);
  }

  const active: ManifestEntry[] = [];
  for (const [, list] of byName) {
    const latest = list[list.length - 1];
    if (latest.action === 'restored') continue;
    const clean = list.find((e) => e.action !== 'restored');
    if (clean) {
      // Strip the legacy `action` field before persisting to v2
      const { action: _discarded, ...v2Entry } = clean;
      active.push(v2Entry);
    }
  }
  return active;
}

export async function migrateLegacyIfNeeded(): Promise<void> {
  const legacyPath = getLegacyManifestPath();
  const newPath = getManifestPath();

  if (!(await pathExists(legacyPath))) return;
  if (await pathExists(newPath)) return; // already migrated

  const content = await readFile(legacyPath, 'utf-8');
  const legacyEntries = parseJsonl(content);
  const activeEntries = collapseLegacy(legacyEntries);

  await ensureDisabledDir();
  const manifest: Manifest = { version: 2, entries: activeEntries };
  const tmpPath = newPath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(manifest, null, 2));
  await rename(tmpPath, newPath);
  try {
    await rename(legacyPath, legacyPath + '.bak');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') throw err;
    // Already renamed by a concurrent migration — safe to ignore
  }
}

export async function readManifestV2(): Promise<Manifest> {
  await migrateLegacyIfNeeded();

  const newPath = getManifestPath();
  try {
    const content = await readFile(newPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && parsed.version === 2 && Array.isArray(parsed.entries)) {
      return parsed as Manifest;
    }
  } catch {
    // fall through to empty manifest
  }
  return { version: 2, entries: [] };
}

export async function writeManifestV2(manifest: Manifest): Promise<void> {
  await ensureDisabledDir();
  const target = getManifestPath();
  const tmp = target + '.tmp';
  await writeFile(tmp, JSON.stringify(manifest, null, 2));
  await rename(tmp, target);
}

export async function addEntry(entry: AnyManifestEntry): Promise<void> {
  const m = await readManifestV2();
  m.entries.push(entry);
  await writeManifestV2(m);
}

export async function removeEntry(name: string): Promise<ManifestEntry | null> {
  const m = await readManifestV2();
  const idx = m.entries.findIndex((e) => !isDisabledPluginEntry(e) && e.name === name);
  if (idx === -1) return null;
  const [removed] = m.entries.splice(idx, 1);
  await writeManifestV2(m);
  return removed as ManifestEntry;
}

export async function recordDisabledPlugin(plugin: string, marketplace: string): Promise<void> {
  const entry: DisabledPluginEntry = {
    type: 'disabled_plugin',
    plugin,
    marketplace,
    disabledAt: new Date().toISOString(),
  };
  await addEntry(entry);
}

export async function findDisabledPlugin(plugin: string, marketplace: string): Promise<DisabledPluginEntry | undefined> {
  const m = await readManifestV2();
  return m.entries.find(
    (e): e is DisabledPluginEntry =>
      isDisabledPluginEntry(e) && e.plugin === plugin && e.marketplace === marketplace,
  );
}

export async function removeDisabledPlugin(plugin: string, marketplace: string): Promise<boolean> {
  const m = await readManifestV2();
  const idx = m.entries.findIndex(
    (e) => isDisabledPluginEntry(e) && e.plugin === plugin && e.marketplace === marketplace,
  );
  if (idx === -1) return false;
  m.entries.splice(idx, 1);
  await writeManifestV2(m);
  return true;
}

// --- Legacy-compatible API (still used by cleaner/cli pending Task 8) ---

export async function readManifest(): Promise<AnyManifestEntry[]> {
  const m = await readManifestV2();
  return m.entries;
}

export async function appendManifest(entry: AnyManifestEntry): Promise<void> {
  await addEntry(entry);
}
