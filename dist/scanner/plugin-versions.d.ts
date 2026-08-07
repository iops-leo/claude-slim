/**
 * Which cached version of a plugin a session actually loads.
 *
 * `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` can hold more than
 * one version directory. `claude plugin update` leaves the old one behind as a
 * symlink to the new one (`4.9.1 -> 4.15.4`), and `stat` follows it, so a naive
 * walk sees two complete installs and counts every skill twice. Only one is ever
 * loaded, so counting both inflated `totalTokensBefore` — the number the whole
 * tool is built to report — by 14.5% on the machine where this was measured.
 */
export interface VersionedDir {
    /** Directory name, normally a semver string. */
    version: string;
    /** Directory mtime in ms, the same signal plugin-surfaces calls `installedAt`. */
    installedAt: number;
}
/**
 * Compare two version directory names, newest last (sort-compatible).
 *
 * Numeric segment by segment, so `4.15.4` beats `4.9.1` — the lexicographic
 * comparison that a plain string sort would do gets that backwards. Non-numeric
 * segments fall back to string order, which keeps prereleases deterministic
 * without pretending to implement full semver precedence.
 */
export declare function compareVersions(a: string, b: string): number;
/**
 * Pick the version a session would load, or null when there are none.
 *
 * Newest mtime wins, matching how `computePluginBreakdown` already chooses among
 * surfaces. An update-symlink and its target report the *same* mtime — `stat`
 * resolves the link — so the tie-break carries the real weight here: highest
 * version. Without it the choice would depend on readdir order.
 */
export declare function pickActiveVersion<T extends VersionedDir>(candidates: T[]): T | null;
