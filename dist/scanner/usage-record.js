import { isObject, readJson, getClaudeJsonPath } from './settings-sources.js';
function recentKeys(map, cutoffMs, requireCount) {
    const keys = new Set();
    if (!isObject(map))
        return keys;
    for (const [key, entry] of Object.entries(map)) {
        if (!isObject(entry))
            continue;
        const { lastUsedAt, usageCount } = entry;
        if (typeof lastUsedAt !== 'number' || lastUsedAt < cutoffMs)
            continue;
        // A pluginUsage entry is created with usageCount 0 and a fresh timestamp
        // the first time the plugin loads; that timestamp is not a use.
        if (requireCount && !(typeof usageCount === 'number' && usageCount > 0))
            continue;
        keys.add(key);
    }
    return keys;
}
export function parseUsageRecord(claudeJson, cutoffMs) {
    const j = isObject(claudeJson) ? claudeJson : {};
    return {
        skills: recentKeys(j.skillUsage, cutoffMs, false),
        plugins: recentKeys(j.pluginUsage, cutoffMs, true),
    };
}
export async function readUsageRecord(lookbackDays, now = Date.now()) {
    const cutoffMs = now - lookbackDays * 24 * 60 * 60 * 1000;
    return parseUsageRecord(await readJson(getClaudeJsonPath()), cutoffMs);
}
