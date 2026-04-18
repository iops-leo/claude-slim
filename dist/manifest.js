import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { getDisabledDir as getDir, getManifestPath, getLegacyManifestPath, } from './paths.js';
export function getDisabledDir() {
    return getDir();
}
export async function ensureDisabledDir() {
    await mkdir(getDisabledDir(), { recursive: true });
}
async function pathExists(p) {
    try {
        await access(p);
        return true;
    }
    catch {
        return false;
    }
}
function parseJsonl(content) {
    const entries = [];
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
function collapseLegacy(entries) {
    // Group by name. If any entry for that name has action='restored', drop all of them.
    // Otherwise keep the first (non-restored) entry.
    const byName = new Map();
    for (const e of entries) {
        const list = byName.get(e.name) ?? [];
        list.push(e);
        byName.set(e.name, list);
    }
    const active = [];
    for (const [, list] of byName) {
        const latest = list[list.length - 1];
        if (latest.action === 'restored')
            continue;
        const clean = list.find((e) => e.action !== 'restored');
        if (clean)
            active.push(clean);
    }
    return active;
}
export async function migrateLegacyIfNeeded() {
    const legacyPath = getLegacyManifestPath();
    const newPath = getManifestPath();
    if (!(await pathExists(legacyPath)))
        return;
    if (await pathExists(newPath))
        return; // already migrated
    const content = await readFile(legacyPath, 'utf-8');
    const legacyEntries = parseJsonl(content);
    const activeEntries = collapseLegacy(legacyEntries);
    await ensureDisabledDir();
    const manifest = { version: 2, entries: activeEntries };
    await writeFile(newPath, JSON.stringify(manifest, null, 2));
    await rename(legacyPath, legacyPath + '.bak');
}
export async function readManifestV2() {
    await migrateLegacyIfNeeded();
    const newPath = getManifestPath();
    try {
        const content = await readFile(newPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed && parsed.version === 2 && Array.isArray(parsed.entries)) {
            return parsed;
        }
    }
    catch {
        // fall through to empty manifest
    }
    return { version: 2, entries: [] };
}
export async function writeManifestV2(manifest) {
    await ensureDisabledDir();
    await writeFile(getManifestPath(), JSON.stringify(manifest, null, 2));
}
export async function addEntry(entry) {
    const m = await readManifestV2();
    m.entries.push(entry);
    await writeManifestV2(m);
}
export async function removeEntry(name) {
    const m = await readManifestV2();
    const idx = m.entries.findIndex((e) => e.name === name);
    if (idx === -1)
        return null;
    const [removed] = m.entries.splice(idx, 1);
    await writeManifestV2(m);
    return removed;
}
// --- Legacy-compatible API (still used by cleaner/cli pending Task 8) ---
export async function readManifest() {
    const m = await readManifestV2();
    return m.entries;
}
export async function appendManifest(entry) {
    await addEntry(entry);
}
