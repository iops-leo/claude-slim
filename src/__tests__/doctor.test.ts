import { describe, expect, it } from 'vitest';
import {
  formatDoctorReport,
  isSupportedRuntimeNode,
  type DoctorReport,
} from '../doctor.js';

describe('isSupportedRuntimeNode', () => {
  it('accepts Node 20 and newer', () => {
    expect(isSupportedRuntimeNode('v20.0.0')).toBe(true);
    expect(isSupportedRuntimeNode('22.12.0')).toBe(true);
    expect(isSupportedRuntimeNode('v24.0.0')).toBe(true);
  });

  it('rejects Node versions below the runtime floor', () => {
    expect(isSupportedRuntimeNode('v18.20.0')).toBe(false);
    expect(isSupportedRuntimeNode('not-a-version')).toBe(false);
  });
});

describe('formatDoctorReport', () => {
  it('summarizes passing, warning, and failing checks', () => {
    const report: DoctorReport = {
      checks: [
        { label: 'Node.js', status: 'ok', detail: 'v22.12.0' },
        {
          label: 'Session transcripts',
          status: 'warn',
          detail: '0 sessions',
          hint: 'Unused-skill detection will be suppressed.',
        },
        {
          label: 'Claude directory',
          status: 'fail',
          detail: '~/.claude missing',
          hint: 'Run Claude Code once.',
        },
      ],
    };

    const formatted = formatDoctorReport(report);
    expect(formatted).toContain('Node.js: v22.12.0');
    expect(formatted).toContain('Session transcripts: 0 sessions');
    expect(formatted).toContain('Unused-skill detection will be suppressed.');
    expect(formatted).toContain('1 failing check(s), 1 warning(s).');
  });
});
