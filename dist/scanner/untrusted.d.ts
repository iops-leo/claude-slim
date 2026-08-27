import type { ScanResult } from '../types.js';
/**
 * Names read off disk are written by whoever authored the skill, plugin, agent,
 * or memory file — not by the person running the scan. They flow through the
 * report into the agent's context, which makes them an indirect prompt
 * injection surface: a directory name can carry instructions aimed at the model
 * rather than a label aimed at a human.
 *
 * Snyk's audit of this skill (W011, medium 0.30) is about exactly this path.
 * The scan never emits file *bodies* — descriptions are measured for token cost
 * and then discarded — so labels are the whole exposed surface.
 *
 * v2.14.1 sanitized a hand-written list of fields and claimed that a single
 * chokepoint could not be forgotten. That was wrong: the chokepoint was one
 * function, but its contents were an enumeration, and the first version of it
 * already missed `pluginSkills[].pluginName`, `pluginSkills[].plugin`, and the
 * entire `codex` subtree — whose skill names are printed to the terminal too.
 * So this walks the result instead of listing its fields. A field added later
 * is covered because it exists, not because someone remembered it.
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
 * Return a copy of any scanned tree with every label flattened and bounded.
 *
 * Numbers and booleans pass through untouched; the input is not mutated.
 *
 * Each scanner applies this at its own exit. There is more than one scanner:
 * `scanCodex()` runs separately and the CLI merges it in at print time
 * (`src/cli.ts`), so `~/.codex` labels never pass through the `~/.claude`
 * scanner and have to be sanitized on their own way out.
 */
export declare function sanitizeUntrustedTree<T>(value: T): T;
/** The `~/.claude` scanner's exit. */
export declare function sanitizeScanResult(result: ScanResult): ScanResult;
