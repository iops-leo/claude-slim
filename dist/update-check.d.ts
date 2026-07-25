export type InstallMethod = 'plugin' | 'global' | 'npx' | 'source' | 'unknown';
export interface UpdateCheckResult {
    installed: string;
    /** null when the lookup failed or was skipped — never treat as "up to date". */
    latest: string | null;
    outdated: boolean;
    installMethod: InstallMethod;
    /** The command that actually upgrades this install, or null if unknown. */
    upgradeCommand: string | null;
    fromCache: boolean;
}
/**
 * Compare dotted numeric versions. Returns >0 if a is newer, <0 if b is newer.
 * Pre-release suffixes (`-beta.1`) sort below the same release, matching semver
 * closely enough for "is there something newer" without pulling in a dep.
 */
export declare function compareVersions(a: string, b: string): number;
/**
 * Infer how this copy was installed from where it sits on disk, so the hint we
 * print is the command that will actually work for this user.
 */
export declare function detectInstallMethod(modulePath: string): InstallMethod;
export declare function upgradeCommandFor(method: InstallMethod): string | null;
export declare function getInstalledVersion(): string;
export interface CheckOptions {
    installed?: string;
    modulePath?: string;
    cachePath?: string;
    now?: number;
    ttlMs?: number;
    /** Ignore a fresh cache entry and re-query. */
    force?: boolean;
    /** Injected for tests; defaults to the real registry lookup. */
    fetchLatest?: () => Promise<string | null>;
}
export declare function checkForUpdate(opts?: CheckOptions): Promise<UpdateCheckResult>;
/** One-line human summary; null when there is nothing worth saying. */
export declare function formatUpdateNotice(result: UpdateCheckResult): string | null;
