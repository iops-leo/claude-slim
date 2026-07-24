import { execFile } from 'node:child_process';
const PLUGIN_NAME_RE = /^[a-zA-Z0-9_-]+$/;
/**
 * Sentinel error class raised when the `claude` CLI is not on PATH.
 * Callers (cleaner.ts) treat this as a "skip, don't error" condition so users
 * running claude-slim outside a Claude Code install don't see a raw ENOENT
 * mid-cleanup.
 */
export class ClaudeCliMissingError extends Error {
    constructor() {
        super("`claude` CLI not found on PATH. Install Claude Code (https://claude.com/product/claude-code) " +
            'to enable/disable plugins, or run `claude-slim clean` without the unused-plugin items selected.');
        this.name = 'ClaudeCliMissingError';
    }
}
function validateName(name) {
    if (!PLUGIN_NAME_RE.test(name)) {
        throw new Error(`Refusing to operate on suspicious plugin name: ${name}`);
    }
}
/**
 * Detects the classic "binary missing from PATH" shape of Node's execFile error.
 * spawn ENOENT surfaces as an Error with { code: 'ENOENT', syscall: 'spawn claude' }.
 * The exact-match on `spawn claude` avoids false positives for hypothetical
 * sibling binaries (e.g. `claude-code`) that might be spawned by future code.
 */
function isClaudeMissing(err) {
    if (!(err instanceof Error))
        return false;
    const e = err;
    return e.code === 'ENOENT' && e.syscall === 'spawn claude';
}
function runPluginCommand(subcommand, name) {
    return new Promise((resolve, reject) => {
        execFile('claude', ['plugin', subcommand, name], { timeout: 30000 }, (err, _stdout, stderr) => {
            if (err) {
                if (isClaudeMissing(err)) {
                    reject(new ClaudeCliMissingError());
                    return;
                }
                const detail = stderr?.trim() ? `: ${stderr.trim()}` : '';
                reject(new Error(`${err.message}${detail}`));
                return;
            }
            if (stderr?.trim()) {
                reject(new Error(stderr.trim()));
                return;
            }
            resolve();
        });
    });
}
/**
 * Best-effort probe: is `claude` on PATH and answering `--version`?
 * Never throws — a false result short-circuits `unused_plugin` cleanup with a
 * friendly message rather than surfacing spawn ENOENT to end users.
 */
export function isClaudeCliAvailable() {
    return new Promise((resolve) => {
        execFile('claude', ['--version'], { timeout: 5000 }, (err) => {
            resolve(!err);
        });
    });
}
/** Validates plugin name then shells out to `claude plugin disable <name>`. */
export async function disablePlugin(name) {
    validateName(name);
    return runPluginCommand('disable', name);
}
/** Validates plugin name then shells out to `claude plugin enable <name>`. */
export async function enablePlugin(name) {
    validateName(name);
    return runPluginCommand('enable', name);
}
