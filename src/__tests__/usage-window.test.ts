import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { scanSessionUsage, readCleanupPeriodDays } from '../scanner/sessions.js';
import { detectors, type DetectorContext } from '../scanner/detectors.js';
import { scan } from '../scanner/index.js';
import { formatScanSummary } from '../report.js';
import { collectDoctorReport } from '../doctor.js';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, writeSkill, type TmpClaude } from './helpers/tmp-claude.js';

/**
 * Claude Code deletes session logs older than `cleanupPeriodDays` (default
 * 30). With a 60-day lookback, "not invoked in 60d" rested on at most 30 days
 * of evidence. The window the logs actually cover is what may be claimed.
 */

const DAY = 86_400_000;
let tmp: TmpClaude;

beforeAll(async () => { await initTokenizer(); });
beforeEach(async () => { tmp = await createTmpClaude(); });
afterEach(async () => { await tmp.cleanup(); });

async function session(name: string, ageDays: number): Promise<void> {
  const proj = join(tmp.projectsDir, '-tmp-proj');
  await mkdir(proj, { recursive: true });
  const p = join(proj, `${name}.jsonl`);
  const line = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'used' } }] },
  });
  await writeFile(p, line + '\n');
  const t = new Date(Date.now() - ageDays * DAY);
  await utimes(p, t, t);
}

describe('effective usage window', () => {
  it('is the age of the oldest surviving log, capped by the lookback', async () => {
    await session('a', 29.5);
    await session('b', 3);
    await session('c', 1);
    expect((await scanSessionUsage(60)).effectiveLookbackDays).toBe(29);
    // A log older than the lookback proves the logs reach the whole window,
    // even if no session happened in its first days.
    expect((await scanSessionUsage(10)).effectiveLookbackDays).toBe(10);
  });

  it('is 0 with no logs in the window', async () => {
    expect((await scanSessionUsage(60)).effectiveLookbackDays).toBe(0);
  });

  it('reads cleanupPeriodDays from settings.json, defaulting to 30', async () => {
    expect(await readCleanupPeriodDays()).toBe(30);
    await writeFile(join(tmp.claudeDir, 'settings.json'), JSON.stringify({ cleanupPeriodDays: 90 }));
    expect(await readCleanupPeriodDays()).toBe(90);
  });
});

describe('issue details claim only the covered window', () => {
  const unusedSkill = detectors.find((d) => d.name === 'unused_skill')!;
  const base = {
    localSkills: [{ name: 'idle', path: '/s/idle', sizeBytes: 1, tokens: 1, listingTokens: 1, source: 'local' as const }],
    recentSkillInvocations: new Set(['x']),
    recentCommands: new Set<string>(),
    recentMcpPrefixes: new Set<string>(),
    sessionDataAvailable: true,
    lookbackDays: 60,
  };

  it('says "of logs" when the logs cover less than the lookback', () => {
    const [issue] = unusedSkill.detect({ ...base, effectiveLookbackDays: 30 } as unknown as DetectorContext);
    expect(issue.detail).toBe('not invoked in 30d of logs');
  });

  it('keeps the plain wording when the logs cover the whole lookback', () => {
    const [issue] = unusedSkill.detect({ ...base, effectiveLookbackDays: 60 } as unknown as DetectorContext);
    expect(issue.detail).toBe('not invoked in 60d');
  });
});

describe('scan, report and doctor surface the window', () => {
  it('reports it in --json and in the text summary', async () => {
    await writeSkill(tmp.skillsDir, 'idle', '---\nname: idle\ndescription: d\n---\nbody\n');
    await session('a', 20.5);
    await session('b', 2);
    await session('c', 1);
    const result = await scan({ lookbackDays: 60 });
    expect(result.usageWindow).toEqual({ lookbackDays: 60, effectiveDays: 20, cleanupPeriodDays: 30 });
    expect(result.issues.find((i) => i.name === 'idle')?.detail).toBe('not invoked in 20d of logs');
    const text = formatScanSummary(result);
    expect(text).toContain('20d of session logs');
    expect(text).toContain('cleanupPeriodDays');
  });

  it('doctor warns when cleanupPeriodDays is shorter than the lookback', async () => {
    const report = await collectDoctorReport({ lookbackDays: 60, checkUpdate: false });
    const check = report.checks.find((c) => c.label === 'Session log retention');
    expect(check?.status).toBe('warn');
    expect(check?.hint).toMatch(/cleanupPeriodDays/);

    await writeFile(join(tmp.claudeDir, 'settings.json'), JSON.stringify({ cleanupPeriodDays: 90 }));
    const ok = await collectDoctorReport({ lookbackDays: 60, checkUpdate: false });
    expect(ok.checks.find((c) => c.label === 'Session log retention')?.status).toBe('ok');
  });
});
