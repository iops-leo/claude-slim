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
export const MAX_NAME_LENGTH = 120;

/** C0/C1 controls, including the newlines that would forge new report rows. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Zero-width and bidi-override characters: invisible to the human reading the
 * report, fully visible to the model reading the same string.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * Keys whose values are truncated only at their peril.
 *
 * Paths locate files that cleanup then acts on, so a shortened path is a wrong
 * path. `currentProjectSlug` is matched against directory names. The two
 * `*Reason` strings are our own prose and already run past the label bound.
 * All of them are still flattened — that is the part that blocks injection.
 */
const FLATTEN_ONLY_KEYS = new Set([
  'path',
  'root',
  'target',
  'currentProjectSlug',
  'unusedDetectionReason',
]);

/** Strip anything that could forge a row or hide from a human reader. */
function flatten(value: string): string {
  return value
    .replace(CONTROL_CHARS, ' ')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Collapse an untrusted label to a single bounded, printable line.
 *
 * Deliberately not an escape or an encoding: the value is a display label, and
 * a reversible transform would relocate a payload rather than remove it.
 */
export function sanitizeUntrusted(value: string, max = MAX_NAME_LENGTH): string {
  const flattened = flatten(value);
  if (flattened.length <= max) return flattened;
  return `${flattened.slice(0, max)}…`;
}

/**
 * Walk any scan value, sanitizing every string it contains.
 *
 * `key` is the property name the string arrived under; for arrays it is
 * inherited from the property holding the array, so `mcpServerNames[]` and
 * `plugins[].skills[]` are treated as the labels they are.
 */
function sanitizeDeep(value: unknown, key: string): unknown {
  if (typeof value === 'string') {
    return FLATTEN_ONLY_KEYS.has(key) ? flatten(value) : sanitizeUntrusted(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDeep(entry, key));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitizeDeep(v, k)]),
    );
  }
  // Numbers, booleans, null, undefined — nothing to sanitize, nothing to copy.
  return value;
}

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
export function sanitizeUntrustedTree<T>(value: T): T {
  return sanitizeDeep(value, '') as T;
}

/** The `~/.claude` scanner's exit. */
export function sanitizeScanResult(result: ScanResult): ScanResult {
  return sanitizeUntrustedTree(result);
}
