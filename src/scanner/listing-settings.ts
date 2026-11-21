// Settings that shape the skill listing, read from the sources Claude Code
// merges: managed > local > project > user for settings, and the global
// config file (`.claude.json`) for the usage record that ranks descriptions.
import type { SettingsSources } from './settings-sources.js';
import type { SkillUsageRecord } from './listing-budget.js';

type Json = Record<string, unknown>;

export interface ListingSettings {
  fraction?: number;
  skillOverrides: Record<string, unknown>;
  skillUsage: Record<string, SkillUsageRecord>;
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function readUsage(claudeJson: Json | null): Record<string, SkillUsageRecord> {
  const raw = claudeJson?.skillUsage;
  if (!isObject(raw)) return {};
  const out: Record<string, SkillUsageRecord> = {};
  for (const [name, v] of Object.entries(raw)) {
    if (!isObject(v)) continue;
    const { usageCount, lastUsedAt } = v;
    if (typeof usageCount === 'number' && typeof lastUsedAt === 'number') {
      out[name] = { usageCount, lastUsedAt };
    }
  }
  return out;
}

export function listingSettingsFrom(src: SettingsSources): ListingSettings {
  // Lowest precedence first, so later spreads win.
  const layers = [
    src.userSettings,
    src.projectSettings,
    ...[...src.localSettingsList].reverse(),
    src.managedSettings,
  ].filter(isObject);
  let fraction: number | undefined;
  let skillOverrides: Record<string, unknown> = {};
  for (const layer of layers) {
    const f = layer.skillListingBudgetFraction;
    if (typeof f === 'number' && f > 0) fraction = f;
    if (isObject(layer.skillOverrides)) skillOverrides = { ...skillOverrides, ...layer.skillOverrides };
  }
  return {
    ...(fraction !== undefined ? { fraction } : {}),
    skillOverrides,
    skillUsage: readUsage(src.claudeJson),
  };
}
