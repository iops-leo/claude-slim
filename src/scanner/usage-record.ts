import { isObject, readJson, getClaudeJsonPath } from './settings-sources.js';

/**
 * Claude Code's own usage record in `.claude.json`:
 *
 *   skillUsage:  { "<skill>": { usageCount, lastUsedAt } }   plugin skills keyed `plugin:skill`
 *   pluginUsage: { "<plugin>@<marketplace>": { usageCount, lastUsedAt, ... } }
 *
 * `lastUsedAt` is epoch milliseconds. Unlike session transcripts, which Claude
 * Code deletes after `cleanupPeriodDays`, this record is kept, so it can vouch
 * for use the surviving logs no longer show. Read-only: never written here.
 */
export interface UsageRecord {
  /** Skill keys last used at or after the cutoff. */
  skills: Set<string>;
  /** `plugin@marketplace` identities with a recorded use at or after the cutoff. */
  plugins: Set<string>;
}

function recentKeys(map: unknown, cutoffMs: number, requireCount: boolean): Set<string> {
  const keys = new Set<string>();
  if (!isObject(map)) return keys;
  for (const [key, entry] of Object.entries(map)) {
    if (!isObject(entry)) continue;
    const { lastUsedAt, usageCount } = entry;
    if (typeof lastUsedAt !== 'number' || lastUsedAt < cutoffMs) continue;
    // A pluginUsage entry is created with usageCount 0 and a fresh timestamp
    // the first time the plugin loads; that timestamp is not a use.
    if (requireCount && !(typeof usageCount === 'number' && usageCount > 0)) continue;
    keys.add(key);
  }
  return keys;
}

export function parseUsageRecord(claudeJson: unknown, cutoffMs: number): UsageRecord {
  const j = isObject(claudeJson) ? claudeJson : {};
  return {
    skills: recentKeys(j.skillUsage, cutoffMs, false),
    plugins: recentKeys(j.pluginUsage, cutoffMs, true),
  };
}

export async function readUsageRecord(lookbackDays: number, now: number = Date.now()): Promise<UsageRecord> {
  const cutoffMs = now - lookbackDays * 24 * 60 * 60 * 1000;
  return parseUsageRecord(await readJson(getClaudeJsonPath()), cutoffMs);
}
