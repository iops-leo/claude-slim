import { describe, it, expect } from 'vitest';
import { calculateReport, formatReportBox } from '../report.js';
import type { ScanResult, Issue } from '../types.js';

/**
 * The report box drew its top and bottom rules two columns wider than its own
 * body, so every rendered report had overhanging corners.
 */

const emptyScan = (totalTokensBefore: number, issues: Issue[] = []): ScanResult => ({
  localSkills: [], pluginSkills: [], plugins: [], brokenSymlinks: [], memoryFiles: [],
  claudeMdBytes: 0, claudeMdTokens: 0, claudeMdSections: [], mcpServers: 0,
  mcpServerNames: [], issues, totalTokensBefore, pluginBreakdown: [],
  userAgents: [], userCommands: [], currentProjectSlug: '-tmp', currentProjectKnown: true,
  currentProjectMemoryTokens: 0, allProjectsMemoryTokens: 0, recoverableStartupTokens: 0,
});

/**
 * The rounded box only — `formatReportBox` also returns the wider before/after
 * table underneath it, which is a separate rule set.
 */
const roundedBox = (out: string): string[] => {
  const lines = out.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));
  const start = lines.findIndex((l) => l.startsWith('╭'));
  const end = lines.findIndex((l) => l.startsWith('╰'));
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end + 1);
};

const widths = (lines: string[]): Set<number> => new Set(lines.map((l) => [...l].length));

describe('formatReportBox borders', () => {
  it('draws every line of the box at one width', () => {
    const box = roundedBox(formatReportBox(calculateReport(emptyScan(10000), emptyScan(6000), [], 2)));
    expect(widths(box)).toEqual(new Set([42]));
  });

  it('keeps the width uniform with the unused-plugin hint present', () => {
    const after = emptyScan(6000, [
      { type: 'unused_plugin', tier: 3, name: 'figma', tokens: 120, path: '/fake' },
    ]);
    const box = roundedBox(formatReportBox(calculateReport(emptyScan(10000), after, [], 2)));
    expect(widths(box).size).toBe(1);
  });

  it('closes each row and matches the rules to the body', () => {
    const box = roundedBox(formatReportBox(calculateReport(emptyScan(10000), emptyScan(6000), [], 2)));
    expect(box[0].endsWith('╮')).toBe(true);
    expect(box[box.length - 1].endsWith('╯')).toBe(true);
    for (const line of box.slice(1, -1)) {
      expect(line.startsWith('│')).toBe(true);
      expect(line.endsWith('│')).toBe(true);
    }
    // The regression: the rule used to run two columns past the body.
    expect([...box[0]].length).toBe([...box[1]].length);
  });
});
