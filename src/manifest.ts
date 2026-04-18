import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { ManifestEntry } from './types.js';
import { getDisabledDir as getDir, getManifestPath, getLegacyManifestPath } from './paths.js';

export function getDisabledDir(): string {
  return getDir();
}

export async function ensureDisabledDir(): Promise<void> {
  await mkdir(getDisabledDir(), { recursive: true });
}

export async function readManifest(): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  let content: string;
  try {
    content = await readFile(getLegacyManifestPath(), 'utf-8');
  } catch {
    return entries;
  }

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

export async function appendManifest(entry: ManifestEntry): Promise<void> {
  await ensureDisabledDir();
  const { appendFile } = await import('node:fs/promises');
  await appendFile(getLegacyManifestPath(), JSON.stringify(entry) + '\n');
}
