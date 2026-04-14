import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { ManifestEntry } from './types.js';

const DISABLED_DIR = join(homedir(), '.claude', 'skills.disabled');
const MANIFEST_PATH = join(DISABLED_DIR, '.claude-slim-manifest.jsonl');

export function getDisabledDir(): string {
  return DISABLED_DIR;
}

export async function ensureDisabledDir(): Promise<void> {
  await mkdir(DISABLED_DIR, { recursive: true });
}

export async function readManifest(): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  let content: string;
  try {
    content = await readFile(MANIFEST_PATH, 'utf-8');
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
  await appendFile(MANIFEST_PATH, JSON.stringify(entry) + '\n');
}
