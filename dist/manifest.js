import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { getDisabledDir as getDir, getLegacyManifestPath } from './paths.js';
export function getDisabledDir() {
    return getDir();
}
export async function ensureDisabledDir() {
    await mkdir(getDisabledDir(), { recursive: true });
}
export async function readManifest() {
    const entries = [];
    let content;
    try {
        content = await readFile(getLegacyManifestPath(), 'utf-8');
    }
    catch {
        return entries;
    }
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            entries.push(JSON.parse(trimmed));
        }
        catch {
            // Skip corrupted lines
        }
    }
    return entries;
}
export async function appendManifest(entry) {
    await ensureDisabledDir();
    await appendFile(getLegacyManifestPath(), JSON.stringify(entry) + '\n');
}
