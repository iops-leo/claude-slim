export interface BackupMatch {
    /** Which convention matched, for showing the user why. */
    label: string;
}
/**
 * Return why `name` looks like a backup artifact, or null if it does not.
 *
 * Matches on the entry name only. Callers decide what to do with it — the
 * Claude path raises a cleanup issue, the Codex path only reports.
 */
export declare function detectBackupArtifact(name: string): BackupMatch | null;
