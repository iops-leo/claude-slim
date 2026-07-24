/**
 * Sentinel error class raised when the `claude` CLI is not on PATH.
 * Callers (cleaner.ts) treat this as a "skip, don't error" condition so users
 * running claude-slim outside a Claude Code install don't see a raw ENOENT
 * mid-cleanup.
 */
export declare class ClaudeCliMissingError extends Error {
    constructor();
}
/**
 * Best-effort probe: is `claude` on PATH and answering `--version`?
 * Never throws — a false result short-circuits `unused_plugin` cleanup with a
 * friendly message rather than surfacing spawn ENOENT to end users.
 */
export declare function isClaudeCliAvailable(): Promise<boolean>;
/** Validates plugin name then shells out to `claude plugin disable <name>`. */
export declare function disablePlugin(name: string): Promise<void>;
/** Validates plugin name then shells out to `claude plugin enable <name>`. */
export declare function enablePlugin(name: string): Promise<void>;
