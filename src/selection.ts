import type { Issue } from './types.js';

export function resolveSelection(input: string, issues: Issue[]): Issue[] {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === 'none' || trimmed === 'n') return [];
  if (trimmed === 'all' || trimmed === 'a') return [...issues];

  if (trimmed === '' || trimmed === 'enter') {
    // Default: tier 1 only
    return issues.filter((i) => i.tier === 1);
  }

  // Parse comma-separated numbers → select exactly those items
  const result: Issue[] = [];
  const seen = new Set<number>();
  for (const part of trimmed.split(',')) {
    const num = parseInt(part.trim(), 10);
    if (!isNaN(num) && num >= 1 && num <= issues.length && !seen.has(num)) {
      seen.add(num);
      result.push(issues[num - 1]);
    }
  }
  return result;
}

export function resolveRestoreSelection(input: string, count: number): number[] {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === 'none' || trimmed === 'n' || trimmed === '') return [];
  if (trimmed === 'all' || trimmed === 'a') {
    return Array.from({ length: count }, (_, i) => i);
  }

  const indices: number[] = [];
  for (const part of trimmed.split(',')) {
    const num = parseInt(part.trim(), 10);
    if (!isNaN(num) && num >= 1 && num <= count) {
      indices.push(num - 1);
    }
  }
  return indices;
}
