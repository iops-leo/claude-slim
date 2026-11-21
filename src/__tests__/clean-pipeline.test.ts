import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dir } from 'tmp-promise';
import type { Issue, ScanResult } from '../types.js';

const scanMock = vi.fn();
const cleanMock = vi.fn();

vi.mock('../scanner.js', () => ({ scan: (...a: unknown[]) => scanMock(...a) }));
vi.mock('../cleaner.js', () => ({ cleanIssues: (...a: unknown[]) => cleanMock(...a) }));
vi.mock('../tokenizer.js', () => ({ initTokenizer: async () => {}, flushCache: async () => {} }));
vi.mock('../report.js', () => ({
  formatScanSummary: () => 'SUMMARY',
  formatReportBox: () => 'REPORT',
  calculateReport: () => ({}),
}));

const { runCleanPipeline } = await import('../clean-pipeline.js');

function issue(name: string, tier: 1 | 2 | 3): Issue {
  return { type: tier === 1 ? 'broken_symlink' : 'unused_skill', tier, name, tokens: 1, path: `/x/${name}` };
}

function result(issues: Issue[]): ScanResult {
  return { issues } as unknown as ScanResult;
}

let out: string[];
let ttyBefore: boolean | undefined;

beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  ttyBefore = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
  process.exitCode = undefined;
  scanMock.mockReset();
  cleanMock.mockReset();
});

afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: ttyBefore, configurable: true });
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

const base = { dryRun: false, auto: false, sessionsPerDay: 2, lookbackDays: 60, codex: false };

describe('clean --dry-run without a TTY', () => {
  it('previews instead of refusing, and changes nothing', async () => {
    scanMock.mockResolvedValue(result([issue('dead', 1), issue('idle', 3)]));
    await runCleanPipeline({ ...base, dryRun: true });
    expect(process.exitCode).toBeUndefined();
    const text = out.join('\n');
    expect(text).toContain('[DRY RUN]');
    expect(text).toContain('dead');
    expect(text).not.toMatch(/Non-interactive shell detected/);
    expect(cleanMock).not.toHaveBeenCalled();
  });

  it('a plain clean without a TTY still refuses', async () => {
    scanMock.mockResolvedValue(result([issue('dead', 1)]));
    await runCleanPipeline(base);
    expect(process.exitCode).toBe(1);
    expect(cleanMock).not.toHaveBeenCalled();
  });
});

describe('clean --project-dir', () => {
  it('rescans the same project after cleaning', async () => {
    const d = await dir({ unsafeCleanup: true });
    try {
      scanMock.mockResolvedValue(result([issue('dead', 1)]));
      cleanMock.mockResolvedValue({ moved: [], skipped: [], errors: [] });
      await runCleanPipeline({ ...base, auto: true, projectDir: d.path });
      expect(scanMock).toHaveBeenCalledTimes(2);
      for (const call of scanMock.mock.calls) {
        expect(call[0]).toMatchObject({ projectDir: d.path, lookbackDays: 60 });
      }
    } finally {
      await d.cleanup();
    }
  });
});
