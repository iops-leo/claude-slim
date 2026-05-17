import { describe, it, expect } from 'vitest';
import { calculateReport, formatReportBox } from '../report.js';
import type { ScanResult, ManifestEntry, Issue } from '../types.js';

function makeScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    localSkills: [],
    pluginSkills: [],
    plugins: [],
    brokenSymlinks: [],
    memoryFiles: [],
    claudeMdBytes: 0,
    claudeMdTokens: 0,
    claudeMdSections: [],
    mcpServers: 0,
    mcpServerNames: [],
    issues: [],
    totalTokensBefore: 0,
    pluginBreakdown: [],
    ...overrides,
  };
}

describe('calculateReport', () => {
  it('calculates savings correctly', () => {
    const before = makeScanResult({ totalTokensBefore: 10000 });
    const after = makeScanResult({ totalTokensBefore: 6000 });
    const moved: ManifestEntry[] = [
      { date: '2025-01-01', name: 'foo', from: '/x', type: 'template', tokenCount: 2000, tier: 1 },
    ];

    const report = calculateReport(before, after, moved, 2);
    expect(report.before).toBe(10000);
    expect(report.after).toBe(6000);
    expect(report.saved).toBe(4000);
    expect(report.percent).toBeCloseTo(40, 0);
  });

  it('returns zero savings when no change', () => {
    const scan = makeScanResult({ totalTokensBefore: 5000 });
    const report = calculateReport(scan, scan, [], 2);
    expect(report.saved).toBe(0);
    expect(report.percent).toBe(0);
  });

  it('sorts top offenders by token count', () => {
    const before = makeScanResult({ totalTokensBefore: 10000 });
    const after = makeScanResult({ totalTokensBefore: 5000 });
    const moved: ManifestEntry[] = [
      { date: '2025-01-01', name: 'small', from: '/a', type: 'template', tokenCount: 100, tier: 1 },
      { date: '2025-01-01', name: 'big', from: '/b', type: 'duplicate', tokenCount: 3000, tier: 2 },
      { date: '2025-01-01', name: 'mid', from: '/c', type: 'template', tokenCount: 500, tier: 1 },
    ];

    const report = calculateReport(before, after, moved, 2);
    expect(report.topOffenders[0].name).toBe('big');
    expect(report.topOffenders[1].name).toBe('mid');
    expect(report.topOffenders[2].name).toBe('small');
  });

  it('calculates monthly savings', () => {
    const before = makeScanResult({ totalTokensBefore: 10000 });
    const after = makeScanResult({ totalTokensBefore: 7000 });
    const report = calculateReport(before, after, [], 5);
    // saved=3000, monthly = (3000/1000) * 0.003 * 5 * 30 = 1.35
    expect(report.monthlySavings).toBeCloseTo(1.35, 2);
  });

  it('breakdown "Saved" column shows positive numbers when cleanup reduces counts', () => {
    const before = makeScanResult({
      localSkills: [
        { name: 's1', path: '/a', sizeBytes: 1024, tokens: 100, source: 'local' },
        { name: 's2', path: '/b', sizeBytes: 2048, tokens: 200, source: 'local' },
        { name: 's3', path: '/c', sizeBytes: 1024, tokens: 150, source: 'local' },
      ],
      memoryFiles: [
        { project: 'p', name: 'old.md', path: '/m', sizeBytes: 8192, tokens: 500 },
      ],
      totalTokensBefore: 10000,
    });
    const after = makeScanResult({
      localSkills: [
        { name: 's1', path: '/a', sizeBytes: 1024, tokens: 100, source: 'local' },
      ],
      memoryFiles: [],
      totalTokensBefore: 4000,
    });

    const report = calculateReport(before, after, [], 2);

    const findRow = (label: string) => report.breakdown.find((r) => r.label === label)!;
    // 3 → 1, saved 2
    expect(findRow('Local skills').saved).toBe('2');
    // ~3 → ~1, saved 2
    expect(findRow('System prompt').saved).toBe('2');
    // 8.0KB → 0.0KB, saved 8.0KB
    expect(findRow('Memory files').saved).toBe('8.0KB');
    // 10K → 4K, saved 6K
    expect(findRow('Est. tokens').saved).toBe('~6,000');
  });
});

// Helper: build an unused_plugin issue
function makeUnusedPluginIssue(name: string, tokens: number): Issue {
  return { type: 'unused_plugin', tier: 3, name, tokens, path: '/fake' };
}

describe('formatReportBox unused plugin hint', () => {
  const baseReport = calculateReport(
    { localSkills: [], pluginSkills: [], plugins: [], brokenSymlinks: [], memoryFiles: [],
      claudeMdBytes: 0, claudeMdTokens: 0, claudeMdSections: [], mcpServers: 0,
      mcpServerNames: [], issues: [], totalTokensBefore: 10000, pluginBreakdown: [] },
    { localSkills: [], pluginSkills: [], plugins: [], brokenSymlinks: [], memoryFiles: [],
      claudeMdBytes: 0, claudeMdTokens: 0, claudeMdSections: [], mcpServers: 0,
      mcpServerNames: [], issues: [], totalTokensBefore: 6000, pluginBreakdown: [] },
    [], 2,
  );

  it('shows no hint when unused plugin count is 0', () => {
    const box = formatReportBox(baseReport);
    expect(box).not.toContain('unused plugin');
  });

  it('shows hint with count when unused plugins exist (plural)', () => {
    const after: ScanResult = {
      localSkills: [], pluginSkills: [], plugins: [], brokenSymlinks: [], memoryFiles: [],
      claudeMdBytes: 0, claudeMdTokens: 0, claudeMdSections: [], mcpServers: 0,
      mcpServerNames: [], totalTokensBefore: 6000, pluginBreakdown: [],
      issues: [
        makeUnusedPluginIssue('figma', 0),
        makeUnusedPluginIssue('graphify', 0),
        makeUnusedPluginIssue('pdf', 0),
      ],
    };
    const report = calculateReport(
      { ...after, totalTokensBefore: 10000, issues: [] },
      after, [], 2,
    );
    const box = formatReportBox(report);
    expect(box).toContain('3 unused plugins');
    expect(box).toContain('Run: claude-slim');
  });

  it('shows singular form for 1 unused plugin', () => {
    const after: ScanResult = {
      localSkills: [], pluginSkills: [], plugins: [], brokenSymlinks: [], memoryFiles: [],
      claudeMdBytes: 0, claudeMdTokens: 0, claudeMdSections: [], mcpServers: 0,
      mcpServerNames: [], totalTokensBefore: 6000, pluginBreakdown: [],
      issues: [makeUnusedPluginIssue('figma', 0)],
    };
    const report = calculateReport(
      { ...after, totalTokensBefore: 10000, issues: [] },
      after, [], 2,
    );
    const box = formatReportBox(report);
    expect(box).toContain('1 unused plugin');
    expect(box).not.toContain('1 unused plugins');
  });

  it('includes token count in hint when tokens > 0', () => {
    const after: ScanResult = {
      localSkills: [], pluginSkills: [], plugins: [], brokenSymlinks: [], memoryFiles: [],
      claudeMdBytes: 0, claudeMdTokens: 0, claudeMdSections: [], mcpServers: 0,
      mcpServerNames: [], totalTokensBefore: 6000, pluginBreakdown: [],
      issues: [
        makeUnusedPluginIssue('figma', 5000),
        makeUnusedPluginIssue('pdf', 3000),
      ],
    };
    const report = calculateReport(
      { ...after, totalTokensBefore: 10000, issues: [] },
      after, [], 2,
    );
    const box = formatReportBox(report);
    expect(box).toContain('~8,000 tok');
  });

  it('omits token count in hint when tokens are 0', () => {
    const after: ScanResult = {
      localSkills: [], pluginSkills: [], plugins: [], brokenSymlinks: [], memoryFiles: [],
      claudeMdBytes: 0, claudeMdTokens: 0, claudeMdSections: [], mcpServers: 0,
      mcpServerNames: [], totalTokensBefore: 6000, pluginBreakdown: [],
      issues: [makeUnusedPluginIssue('figma', 0)],
    };
    const report = calculateReport(
      { ...after, totalTokensBefore: 10000, issues: [] },
      after, [], 2,
    );
    const box = formatReportBox(report);
    expect(box).toContain('1 unused plugin');
    // hint line should not include "~X tok" token annotation
    const hintLine = box.split('\n').find(l => l.includes('unused plugin'))!;
    expect(hintLine).not.toContain('~');
    expect(hintLine).not.toContain(' tok)');
  });

  it('hint line width matches other non-blank content lines', () => {
    // Strip ANSI, find non-blank │ lines (blank lines are wider by design: W spaces vs W-2 for content)
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const getNonBlankContentWidths = (box: string) =>
      box.split('\n')
        .map(stripAnsi)
        .filter(l => l.startsWith('│') && l.trim() !== '│');

    const after: ScanResult = {
      localSkills: [], pluginSkills: [], plugins: [], brokenSymlinks: [], memoryFiles: [],
      claudeMdBytes: 0, claudeMdTokens: 0, claudeMdSections: [], mcpServers: 0,
      mcpServerNames: [], totalTokensBefore: 6000, pluginBreakdown: [],
      issues: [makeUnusedPluginIssue('figma', 0), makeUnusedPluginIssue('pdf', 0)],
    };
    const reportWith = calculateReport(
      { ...after, totalTokensBefore: 10000, issues: [] },
      after, [], 2,
    );
    const boxWith = formatReportBox(reportWith);
    const nonBlankLines = getNonBlankContentWidths(boxWith);

    expect(nonBlankLines.length).toBeGreaterThan(0);
    // hint line and other content lines must all have the same width
    const widths = nonBlankLines.map(l => l.length);
    const allSame = widths.every(w => w === widths[0]);
    expect(allSame).toBe(true);
  });
});
