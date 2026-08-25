import type { ScanResult } from '../types.js';
/**
 * Names read off disk are written by whoever authored the skill, plugin, or
 * memory file — not by the user running the scan. They flow through the report
 * into the agent's context, which makes them an indirect prompt injection
 * surface: a skill directory or frontmatter `name:` can carry instructions
 * aimed at the model rather than a label aimed at a human.
 *
 * Snyk's audit of this skill (W011, medium 0.30) is about exactly this path.
 * The scan never emits file *bodies* — descriptions are measured for token cost
 * and then discarded — so what this module covers is the whole exposed surface,
 * not a sample of it.
 */
/** Longest label we render. Real names are far shorter; payloads are not. */
export declare const MAX_NAME_LENGTH = 120;
/**
 * Collapse an untrusted label to a single bounded, printable line.
 *
 * Deliberately not an escape or an encoding: the value is a display label, and
 * a reversible transform would relocate a payload rather than remove it.
 */
export declare function sanitizeUntrusted(value: string, max?: number): string;
/**
 * Return a copy of the scan with every outsider-authored label flattened.
 *
 * Applied once at the scanner's exit rather than at each of the dozen sites
 * that read a name off disk: one chokepoint cannot be forgotten by whoever adds
 * the next detector.
 */
export declare function sanitizeScanResult(result: ScanResult): ScanResult;
