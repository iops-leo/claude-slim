import type { SkillInfo } from '../types.js';
import { type SettingsSources } from './settings-sources.js';
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
/**
 * @param takenNames short names already used by other skills or commands
 *   (compared case-insensitively). A synced skill whose short name is taken is
 *   listed under its full `anthropic-skills:<name>`, which costs more tokens.
 */
export declare function scanSyncedSkills(src: SettingsSources, takenNames?: Set<string>): Promise<SyncedSkillsResult>;
