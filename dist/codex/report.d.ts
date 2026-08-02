import type { CodexScanResult } from './index.js';
/**
 * Render the Codex section appended to `scan` output.
 *
 * Deliberately reports only what Codex can actually tell us. The "not
 * available" line for unused-skill detection is not an apology — stating the
 * limit is what keeps the tool from inventing a signal it does not have.
 */
export declare function formatCodexSummary(result: CodexScanResult): string;
