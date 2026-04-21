import { describe, it, expect } from 'vitest';
import { resolveSelection, resolveRestoreSelection } from '../selection.js';
import type { Issue } from '../types.js';

function makeIssue(tier: 1 | 2 | 3, name: string): Issue {
  return { type: 'template', tier, name, tokens: 100, path: `/fake/${name}` };
}

describe('resolveSelection', () => {
  const issues: Issue[] = [
    makeIssue(1, 'broken-a'),
    makeIssue(1, 'broken-b'),
    makeIssue(2, 'dup-c'),
    makeIssue(2, 'dup-d'),
    makeIssue(3, 'big-e'),
  ];

  it('returns Tier 1 on empty input (Enter)', () => {
    const result = resolveSelection('', issues);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.name)).toEqual(['broken-a', 'broken-b']);
  });

  it('returns Tier 1 on "enter"', () => {
    const result = resolveSelection('enter', issues);
    expect(result).toHaveLength(2);
  });

  it('returns all on "all"', () => {
    expect(resolveSelection('all', issues)).toHaveLength(5);
    expect(resolveSelection('a', issues)).toHaveLength(5);
  });

  it('returns empty on "none"', () => {
    expect(resolveSelection('none', issues)).toHaveLength(0);
    expect(resolveSelection('n', issues)).toHaveLength(0);
  });

  it('selects specific items by number', () => {
    const result = resolveSelection('3,5', issues);
    expect(result.map((i) => i.name)).toEqual(['dup-c', 'big-e']);
  });

  it('selects a single item', () => {
    const result = resolveSelection('4', issues);
    expect(result.map((i) => i.name)).toEqual(['dup-d']);
  });

  it('deduplicates repeated numbers', () => {
    const result = resolveSelection('2,2,2', issues);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('broken-b');
  });

  it('ignores out-of-range numbers', () => {
    const result = resolveSelection('0,6,99', issues);
    expect(result).toHaveLength(0);
  });

  it('ignores non-numeric input', () => {
    const result = resolveSelection('abc,xyz', issues);
    expect(result).toHaveLength(0);
  });

  it('handles mixed valid/invalid', () => {
    const result = resolveSelection('1, abc, 3', issues);
    expect(result.map((i) => i.name)).toEqual(['broken-a', 'dup-c']);
  });

  it('handles whitespace around numbers', () => {
    const result = resolveSelection('  1 , 2 , 3  ', issues);
    expect(result).toHaveLength(3);
  });
});

describe('resolveRestoreSelection', () => {
  it('returns empty on empty input', () => {
    expect(resolveRestoreSelection('', 5)).toEqual([]);
  });

  it('returns empty on "none"', () => {
    expect(resolveRestoreSelection('none', 5)).toEqual([]);
    expect(resolveRestoreSelection('n', 5)).toEqual([]);
  });

  it('returns all indices on "all"', () => {
    expect(resolveRestoreSelection('all', 3)).toEqual([0, 1, 2]);
    expect(resolveRestoreSelection('a', 3)).toEqual([0, 1, 2]);
  });

  it('selects specific items (1-indexed)', () => {
    expect(resolveRestoreSelection('2,3', 5)).toEqual([1, 2]);
  });

  it('ignores out-of-range', () => {
    expect(resolveRestoreSelection('0,6', 5)).toEqual([]);
  });

  it('deduplicates repeated numbers', () => {
    expect(resolveRestoreSelection('2,2,2', 5)).toEqual([1]);
    expect(resolveRestoreSelection('1,3,1,3', 5)).toEqual([0, 2]);
  });
});
