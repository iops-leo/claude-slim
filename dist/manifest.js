import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { getDisabledDir as getDir, getAgentDisabledDir, getManifestPath, getLegacyManifestPath, } from './paths.js';
export function getDisabledDir() {
    return getDir();
}
/** Create (if needed) and return the disabled-skill store for one agent. */
export async function ensureDisabledDir(agent = 'claude') {
    const dir = getAgentDisabledDir(agent);
    await mkdir(dir, { recursive: true });
    return dir;
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
function isDisabledPluginEntry(e) {
    return e.type === 'disabled_plugin' && 'plugin' in e && 'marketplace' in e;
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
    // Group by name. If the latest entry for a name has action='restored',
    // the item was restored and is excluded. Otherwise keep the first
    // (earliest clean record) as the canonical entry.
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
        if (clean) {
            // Strip the legacy `action` field before persisting to v2
            const { action: _discarded, ...v2Entry } = clean;
            active.push(v2Entry);
        }
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
    const tmpPath = newPath + '.tmp';
    await writeFile(tmpPath, JSON.stringify(manifest, null, 2));
    await rename(tmpPath, newPath);
    try {
        await rename(legacyPath, legacyPath + '.bak');
    }
    catch (err) {
        const code = err?.code;
        if (code !== 'ENOENT')
            throw err;
        // Already renamed by a concurrent migration — safe to ignore
    }
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
    const target = getManifestPath();
    const tmp = target + '.tmp';
    await writeFile(tmp, JSON.stringify(manifest, null, 2));
    await rename(tmp, target);
}
export async function addEntry(entry) {
    const m = await readManifestV2();
    m.entries.push(entry);
    await writeManifestV2(m);
}
export async function removeEntry(name) {
    const m = await readManifestV2();
    const idx = m.entries.findIndex((e) => !isDisabledPluginEntry(e) && e.name === name);
    if (idx === -1)
        return null;
    const [removed] = m.entries.splice(idx, 1);
    await writeManifestV2(m);
    return removed;
}
export async function recordDisabledPlugin(plugin, marketplace) {
    const entry = {
        type: 'disabled_plugin',
        plugin,
        marketplace,
        disabledAt: new Date().toISOString(),
    };
    await addEntry(entry);
}
export async function findDisabledPlugin(plugin, marketplace) {
    const m = await readManifestV2();
    return m.entries.find((e) => isDisabledPluginEntry(e) && e.plugin === plugin && e.marketplace === marketplace);
}
export async function removeDisabledPlugin(plugin, marketplace) {
    const m = await readManifestV2();
    const idx = m.entries.findIndex((e) => isDisabledPluginEntry(e) && e.plugin === plugin && e.marketplace === marketplace);
    if (idx === -1)
        return false;
    m.entries.splice(idx, 1);
    await writeManifestV2(m);
    return true;
}
// --- Legacy-compatible API (still used by cleaner/cli pending Task 8) ---
export async function readManifest() {
    const m = await readManifestV2();
    return m.entries;
}
export async function appendManifest(entry) {
    await addEntry(entry);
}
