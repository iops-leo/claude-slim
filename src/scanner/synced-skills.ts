import { join } from 'node:path';
import { getSkillsDir } from '../paths.js';
import { countTokensCached } from '../tokenizer.js';
import type { SkillInfo } from '../types.js';
import { safeReadFile, safeReaddir, isDirectory } from './fs-walk.js';
import { listingTokensFromContent } from './skill-listing.js';
import { type SettingsSources, isObject, readJson } from './settings-sources.js';

/**
 * Skills synced from claude.ai live in `~/.claude/skills/synced/<bucket>/`,
 * one bucket per account (https://code.claude.com/docs/en/skills.md, "Where
 * synced skills load"). A session loads only the bucket of the account it is
 * signed in with — not every bucket on disk. Counting all of them listed 38
 * skills on a machine whose sessions load 9.
 *
 * Bucket names are `<organizationUuid>_<accountUuid>`, matched against
 * `oauthAccount` in `~/.claude.json`. The naming is observed, not documented;
 * when nothing matches, every bucket is reported inactive rather than guessed.
 */

export type InactiveReason = 'other account' | 'not signed in' | 'sync off';

export interface SyncedBucket {
  bucket: string;
  skills: number;
  reason: InactiveReason;
}

export interface SyncedSkillsResult {
  /** Skills a session signed in with this account loads, as `anthropic-skills:<name>`. */
  active: SkillInfo[];
  /** Buckets on disk that no session here loads. */
  inactive: SyncedBucket[];
}

function activeBucketName(src: SettingsSources): string | null {
  const account = src.claudeJson?.oauthAccount;
  if (!isObject(account)) return null;
  const { organizationUuid: org, accountUuid: acct } = account;
  // Claude Code lowercases both UUIDs when it names the bucket.
  return typeof org === 'string' && typeof acct === 'string'
    ? `${org.toLowerCase()}_${acct.toLowerCase()}`
    : null;
}

/**
 * `syncClaudeAiSkills: false` stops loading synced skills. Honoured from user,
 * local and managed settings only — a repository can't turn it off.
 */
function syncTurnedOff(src: SettingsSources): boolean {
  if ([src.managedSettings, ...src.localSettingsList, src.userSettings].some((s) => s?.syncClaudeAiSkills === false)) {
    return true;
  }
  // Managed `strictPluginOnlyCustomization` locking the skills surface also
  // stops loading synced skills.
  const lock = src.managedSettings?.strictPluginOnlyCustomization;
  return lock === true || (Array.isArray(lock) && lock.includes('skills'));
}

async function skillDirs(bucketDir: string): Promise<string[]> {
  const entries = (await safeReaddir(bucketDir)).filter((e) => !e.startsWith('.'));
  const dirs: string[] = [];
  for (const e of entries) {
    if ((await isDirectory(join(bucketDir, e))) && (await safeReadFile(join(bucketDir, e, 'SKILL.md'))) !== null) {
      dirs.push(e);
    }
  }
  // The bucket's manifest is the sync's own list; a folder it dropped is a
  // leftover a later sync will remove, not a loaded skill.
  const manifest = await readJson(join(bucketDir, 'manifest.json'));
  if (!manifest || !Array.isArray(manifest.skills)) return dirs.sort();
  const listed = new Set(
    manifest.skills.flatMap((s) => (isObject(s) ? [s.skillId, s.name].filter((v) => typeof v === 'string') : [])),
  );
  return dirs.filter((d) => listed.has(d)).sort();
}

/**
 * @param takenNames short names already used by other skills or commands
 *   (compared case-insensitively). A synced skill whose short name is taken is
 *   listed under its full `anthropic-skills:<name>`, which costs more tokens.
 */
export async function scanSyncedSkills(
  src: SettingsSources,
  takenNames: Set<string> = new Set(),
): Promise<SyncedSkillsResult> {
  const root = join(getSkillsDir(), 'synced');
  const buckets: string[] = [];
  for (const b of await safeReaddir(root)) {
    if (!b.startsWith('.') && (await isDirectory(join(root, b)))) buckets.push(b);
  }

  const activeName = syncTurnedOff(src) ? null : activeBucketName(src);
  const active: SkillInfo[] = [];
  const inactive: SyncedBucket[] = [];

  for (const bucket of buckets.sort()) {
    const dir = join(root, bucket);
    const names = await skillDirs(dir);
    if (bucket !== activeName) {
      const reason: InactiveReason = syncTurnedOff(src)
        ? 'sync off'
        : activeBucketName(src) === null ? 'not signed in' : 'other account';
      inactive.push({ bucket, skills: names.length, reason });
      continue;
    }
    for (const name of names) {
      const mdPath = join(dir, name, 'SKILL.md');
      const content = (await safeReadFile(mdPath)) ?? '';
      active.push({
        name: `anthropic-skills:${name}`,
        path: join(dir, name),
        sizeBytes: Buffer.byteLength(content),
        tokens: countTokensCached(content, mdPath),
        // Listed under its short name unless another command already uses it.
        listingTokens: listingTokensFromContent(
          takenNames.has(name.toLowerCase()) ? `anthropic-skills:${name}` : name,
          content,
        ),
        source: 'synced',
      });
    }
  }
  return { active, inactive };
}
