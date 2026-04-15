import { describe, it, expect } from 'vitest';
import { calculateReport } from '../report.js';
import type { ScanResult, ManifestEntry } from '../types.js';

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

  it('handles null scanAfter (estimate mode)', () => {
    const before = makeScanResult({ totalTokensBefore: 8000 });
    const report = calculateReport(before, null, [], 2);
    expect(report.saved).toBe(0);
    expect(report.after).toBe(8000);
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
});
