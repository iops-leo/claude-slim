import { describe, it, expect } from 'vitest';
import { formatMeasuredSection } from '../report-measured.js';
import type { ScanResult } from '../types.js';

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

function result(overrides: Partial<ScanResult>): ScanResult {
  return overrides as ScanResult;
}

describe('formatMeasuredSection', () => {
  it('prints nothing without a measured session', () => {
    expect(formatMeasuredSection(result({}))).toEqual([]);
  });

  it('reports name-only skills grouped by source, and a doubled connector', () => {
    const out = strip(
      formatMeasuredSection(
        result({
          measuredStartup: {
            sessionFile: '/p/s.jsonl',
            fromOtherProject: false,
            firstTurnInputTokens: 80_430,
            deferredTools: {
              count: 4,
              chars: 100,
              tokens: 30,
              servers: [{ server: 'b', tools: 2, chars: 50 }],
              collisions: [{ tool: 'x', servers: ['a', 'b'] }],
              duplicateServers: [{ servers: ['a', 'b'], shared: 3, chars: 60 }],
              needsAuth: [],
            },
          },
          listingVisibility: {
            sessionFile: '/p/s.jsonl',
            sessionDate: '2026-11-20',
            claudeCodeVersion: '2.1.323',
            fromOtherProject: false,
            skillCount: 5,
            listingChars: 5_700,
            listingWidth: 5_900,
            listingTokens: 1_900,
            budgetChars: 6_000,
            budgetBasis: 'inferred',
            nameOnlyByChoice: 1,
            overBudget: { capTokens: 1_950, fullTokens: 2_400 },
            collapsed: [
              { name: 'omc:ralph', source: 'plugin', plugin: 'omc', flaggedUnused: false },
              { name: 'omc:plan', source: 'plugin', plugin: 'omc', flaggedUnused: false },
              { name: 'idle', source: 'local', flaggedUnused: true },
            ],
            restoredIfFlaggedCleaned: 2,
          },
        }),
      ).join('\n'),
    );
    expect(out).toContain('MEASURED AT SESSION START');
    expect(out).toContain('2026-11-20 · Claude Code 2.1.323 · this project');
    expect(out).toContain('80,430 tok');
    expect(out).toContain('5,900 / 6,000 columns budget · 5 skills');
    expect(out).toContain('1 more are name-only by your skillOverrides');
    expect(out).toContain('3 of 5 skills are listed by name only');
    expect(out).toMatch(/plugin omc\s+2\s+ralph, plan/);
    expect(out).toMatch(/local\s+1\s+idle \(unused\)/);
    expect(out).toContain('bring back ~2 descriptions');
    expect(out).toContain('a and b expose the same 3 tools');
    // The collision inside the doubled pair is not repeated as its own warning.
    expect(out).not.toContain('tool name x');
  });
});
