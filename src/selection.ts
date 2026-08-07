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

/** Expand a `N` or `N-M` fragment into 1-based indices, or null if malformed. */
function parseFragment(part: string, count: number): number[] | null {
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
  if (range) {
    const lo = parseInt(range[1], 10);
    const hi = parseInt(range[2], 10);
    if (lo < 1 || hi < 1 || lo > count || hi > count || lo > hi) return null;
    return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  }
  if (!/^\d+$/.test(part)) return null;
  const num = parseInt(part, 10);
  if (num < 1 || num > count) return null;
  return [num];
}

export function parseSelection(input: string, count: number): ParsedSelection {
  const indices: number[] = [];
  const invalid: string[] = [];
  const seen = new Set<number>();

  for (const raw of input.trim().toLowerCase().split(',')) {
    const part = raw.trim();
    if (part === '') continue;
    const nums = parseFragment(part, count);
    if (nums === null) {
      invalid.push(part);
      continue;
    }
    for (const num of nums) {
      if (seen.has(num)) continue;
      seen.add(num);
      indices.push(num);
    }
  }

  return { indices, invalid };
}

export function resolveSelection(input: string, issues: Issue[]): Issue[] {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === 'none' || trimmed === 'n') return [];
  if (trimmed === 'all' || trimmed === 'a') return [...issues];

  if (trimmed === '' || trimmed === 'enter') {
    // Default: tier 1 only
    return issues.filter((i) => i.tier === 1);
  }

  return parseSelection(trimmed, issues.length).indices.map((n) => issues[n - 1]);
}

export function resolveRestoreSelection(input: string, count: number): number[] {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === 'none' || trimmed === 'n' || trimmed === '') return [];
  if (trimmed === 'all' || trimmed === 'a') {
    return Array.from({ length: count }, (_, i) => i);
  }

  // 0-based, unlike resolveSelection — restore indexes into the manifest array.
  return parseSelection(trimmed, count).indices.map((n) => n - 1);
}
