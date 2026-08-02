import type { Issue } from '../types.js';
import type { CodexScanResult } from './index.js';
export interface CodexDetectorContext {
    scan: CodexScanResult;
    /** SKILL.md contents keyed by absolute path, so detectors need not re-read. */
    contents: Map<string, string>;
}
/** Tier 1 — a SKILL.md symlink whose target is gone. Contributes nothing. */
export declare function detectBrokenSymlinks(ctx: CodexDetectorContext): Promise<Issue[]>;
/** Tier 1 — a scaffold nobody filled in. */
export declare function detectTemplates(ctx: CodexDetectorContext): Issue[];
/**
 * Tier 1 — `~/.codex/.tmp`, where interrupted plugin installs accumulate.
 * Sized rather than token-counted: this is disk, not context.
 */
export declare function detectInstallLeftovers(): Promise<Issue[]>;
/** Tier 2 — a leftover copy, recognised by name shape alone. */
export declare function detectBackups(ctx: CodexDetectorContext): Issue[];
/**
 * Tier 2 — a local skill shadowed by a plugin-provided one of the same name.
 * Removing the local copy leaves the plugin version in place.
 */
export declare function detectDuplicates(ctx: CodexDetectorContext): Issue[];
/** Tier 3 — large enough to be worth a look, but possibly still in use. */
export declare function detectOversized(ctx: CodexDetectorContext): Issue[];
export declare function classifyCodexIssues(ctx: CodexDetectorContext): Promise<Issue[]>;
