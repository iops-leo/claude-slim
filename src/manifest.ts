import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import type { Manifest, ManifestEntry } from './types.js';
import {
  getDisabledDir as getDir,
  getManifestPath,
  getLegacyManifestPath,
} from './paths.js';

export function getDisabledDir(): string {
  return getDir();
}

export async function ensureDisabledDir(): Promise<void> {
  await mkdir(getDisabledDir(), { recursive: true });
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
type LegacyManifestEntry = ManifestEntry & { action?: 'restored' };

function parseJsonl(content: string): LegacyManifestEntry[] {
  const entries: LegacyManifestEntry[] = [];
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

function collapseLegacy(entries: LegacyManifestEntry[]): ManifestEntry[] {
  // Group by name. If the latest entry for a name has action='restored',
  // the item was restored and is excluded. Otherwise keep the first
  // (earliest clean record) as the canonical entry.
  const byName = new Map<string, LegacyManifestEntry[]>();
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

export async function addEntry(entry: ManifestEntry): Promise<void> {
  const m = await readManifestV2();
  m.entries.push(entry);
  await writeManifestV2(m);
}

export async function removeEntry(name: string): Promise<ManifestEntry | null> {
  const m = await readManifestV2();
  const idx = m.entries.findIndex((e) => e.name === name);
  if (idx === -1) return null;
  const [removed] = m.entries.splice(idx, 1);
  await writeManifestV2(m);
  return removed;
}

// --- Legacy-compatible API (still used by cleaner/cli pending Task 8) ---

export async function readManifest(): Promise<ManifestEntry[]> {
  const m = await readManifestV2();
  return m.entries;
}

export async function appendManifest(entry: ManifestEntry): Promise<void> {
  await addEntry(entry);
}
