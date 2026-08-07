import { describe, it, expect } from 'vitest';
import { parseSelection, resolveSelection, resolveRestoreSelection } from '../selection.js';
import type { Issue } from '../types.js';

/**
 * Regression guard for a silent under-selection.
 *
 * The issue list routinely runs past 70 numbered rows, where `1-20` is the
 * obvious way to pick a span. `parseInt('1-20')` is `1`, so the old parser
 * selected a single item, dropped the rest, and said nothing — the user
 * confirmed what they thought was twenty cleanups and got one.
 */

const issues = (n: number): Issue[] =>
  Array.from({ length: n }, (_, i) => ({
    type: 'unused_skill' as const,
    tier: 3 as const,
    name: `skill-${i + 1}`,
    tokens: 100,
    path: `/tmp/skill-${i + 1}`,
  }));

describe('parseSelection', () => {
  it('expands a range instead of truncating it to its first number', () => {
    expect(parseSelection('1-5', 74).indices).toEqual([1, 2, 3, 4, 5]);
  });

  it('mixes ranges and single numbers', () => {
    expect(parseSelection('2, 5-7, 11', 20).indices).toEqual([2, 5, 6, 7, 11]);
  });

  it('tolerates spaces inside a range', () => {
    expect(parseSelection('3 - 5', 10).indices).toEqual([3, 4, 5]);
  });

  it('de-duplicates overlapping selections', () => {
    expect(parseSelection('1-3, 2, 3-4', 10).indices).toEqual([1, 2, 3, 4]);
  });

  it('reports fragments it could not understand rather than dropping them', () => {
    const { indices, invalid } = parseSelection('2, banana, 9', 10);
    expect(indices).toEqual([2, 9]);
    expect(invalid).toEqual(['banana']);
  });

  it('rejects out-of-bounds numbers and ranges', () => {
    expect(parseSelection('0', 10).invalid).toEqual(['0']);
    expect(parseSelection('11', 10).invalid).toEqual(['11']);
    expect(parseSelection('5-99', 10).invalid).toEqual(['5-99']);
  });

  it('rejects a backwards range', () => {
    expect(parseSelection('9-2', 10).invalid).toEqual(['9-2']);
  });

  it('rejects a number with trailing junk instead of silently parsing a prefix', () => {
    // The precise shape of the original bug: parseInt would return 12 here.
    expect(parseSelection('12abc', 20).invalid).toEqual(['12abc']);
  });
});

describe('resolveSelection', () => {
  it('honours ranges', () => {
    const picked = resolveSelection('2-4', issues(10));
    expect(picked.map((i) => i.name)).toEqual(['skill-2', 'skill-3', 'skill-4']);
  });

  it('still supports the keywords', () => {
    const all = issues(5);
    expect(resolveSelection('all', all)).toHaveLength(5);
    expect(resolveSelection('none', all)).toHaveLength(0);
  });

  it('defaults to tier 1 on empty input', () => {
    const mixed: Issue[] = [
      { type: 'broken_symlink', tier: 1, name: 'a', tokens: 0, path: '/a' },
      { type: 'unused_skill', tier: 3, name: 'b', tokens: 9, path: '/b' },
    ];
    expect(resolveSelection('', mixed).map((i) => i.name)).toEqual(['a']);
  });

  it('never returns a hole for an unparseable fragment', () => {
    // A dropped fragment used to leave `undefined` reachable if bounds slipped.
    expect(resolveSelection('nonsense', issues(5))).toEqual([]);
  });
});

describe('resolveRestoreSelection', () => {
  it('expands ranges into 0-based indices', () => {
    expect(resolveRestoreSelection('2-4', 10)).toEqual([1, 2, 3]);
  });

  it('keeps all/none behaviour', () => {
    expect(resolveRestoreSelection('all', 3)).toEqual([0, 1, 2]);
    expect(resolveRestoreSelection('none', 3)).toEqual([]);
    expect(resolveRestoreSelection('', 3)).toEqual([]);
  });
});
