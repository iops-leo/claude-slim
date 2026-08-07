import type { Issue } from './types.js';
/**
 * Parsed selection input, including whatever could not be understood.
 *
 * Unparseable fragments used to be dropped in silence. On a list that routinely
 * runs to 70+ numbered items, the natural way to pick a span is `1-20` — and
 * `parseInt('1-20')` is `1`, so the user asked for twenty items, got one, and
 * was told nothing. Surfacing `invalid` lets the caller say what it ignored.
 */
export interface ParsedSelection {
    indices: number[];
    invalid: string[];
}
export declare function parseSelection(input: string, count: number): ParsedSelection;
export declare function resolveSelection(input: string, issues: Issue[]): Issue[];
export declare function resolveRestoreSelection(input: string, count: number): number[];
