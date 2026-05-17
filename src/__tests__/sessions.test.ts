import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, utimes, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extractSkillsFromTranscript,
  scanSessionUsage,
} from '../scanner/sessions.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';

describe('extractSkillsFromTranscript', () => {
  it('returns empty for empty input', () => {
    expect(extractSkillsFromTranscript('')).toEqual([]);
  });

  it('extracts skill name from a single Skill tool_use event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'Skill', input: { skill: 'superpowers:brainstorming' } },
        ],
      },
    });
    expect(extractSkillsFromTranscript(line + '\n')).toEqual([
      'superpowers:brainstorming',
    ]);
  });

  it('extracts multiple skills across lines and content blocks', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'preamble' },
            { type: 'tool_use', name: 'Skill', input: { skill: 'init' } },
            { type: 'tool_use', name: 'Read', input: { file_path: '/x' } },
            { type: 'tool_use', name: 'Skill', input: { skill: 'commit' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', name: 'Skill', input: { skill: 'commit' } },
          ],
        },
      }),
    ];
    expect(extractSkillsFromTranscript(lines.join('\n'))).toEqual([
      'init',
      'commit',
      'commit',
    ]);
  });

  it('ignores malformed lines and unrelated tool_use events', () => {
    const lines = [
      'not json',
      JSON.stringify({ type: 'permission-mode' }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'string-not-array' },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
        },
      }),
    ];
    expect(extractSkillsFromTranscript(lines.join('\n'))).toEqual([]);
  });

  it('skips Skill events whose input lacks a string skill field', () => {
    const line = JSON.stringify({
      message: {
        content: [
          { type: 'tool_use', name: 'Skill', input: { args: 'something' } },
          { type: 'tool_use', name: 'Skill', input: { skill: 42 } },
          { type: 'tool_use', name: 'Skill' },
        ],
      },
    });
    expect(extractSkillsFromTranscript(line)).toEqual([]);
  });
});

describe('scanSessionUsage', () => {
  let tmp: TmpClaude;

  beforeEach(async () => {
    tmp = await createTmpClaude();
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  async function writeSession(
    project: string,
    sessionId: string,
    skills: string[],
    mtimeDate?: Date,
  ): Promise<string> {
    const projectDir = join(tmp.projectsDir, project);
    await mkdir(projectDir, { recursive: true });
    const filePath = join(projectDir, `${sessionId}.jsonl`);
    const lines = skills.map((skill) =>
      JSON.stringify({
        message: {
          content: [{ type: 'tool_use', name: 'Skill', input: { skill } }],
        },
      })
    );
    await writeFile(filePath, lines.join('\n') + '\n');
    if (mtimeDate) {
      await utimes(filePath, mtimeDate, mtimeDate);
    }
    return filePath;
  }

  it('returns empty + dataAvailable=false when projects dir is missing', async () => {
    // Wipe projectsDir; createTmpClaude makes it but we want the missing case.
    const result = await scanSessionUsage(60);
    expect(result.invokedSkills.size).toBe(0);
    expect(result.dataAvailable).toBe(false);
  });

  it('aggregates skills across multiple sessions and projects', async () => {
    await writeSession('proj-a', 's1', ['init', 'commit']);
    await writeSession('proj-a', 's2', ['init']);
    await writeSession('proj-b', 's3', ['superpowers:brainstorming']);

    const result = await scanSessionUsage(60);

    expect(Array.from(result.invokedSkills).sort()).toEqual([
      'commit',
      'init',
      'superpowers:brainstorming',
    ]);
    expect(result.sessionsInWindow).toBe(3);
    expect(result.dataAvailable).toBe(true);
  });

  it('excludes sessions whose mtime is outside the lookback window', async () => {
    const ancient = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await writeSession('proj-a', 'old', ['stale-skill'], ancient);
    await writeSession('proj-a', 'fresh-1', ['fresh-skill']);
    await writeSession('proj-a', 'fresh-2', ['fresh-skill']);
    await writeSession('proj-a', 'fresh-3', ['fresh-skill']);

    const result = await scanSessionUsage(60);

    expect(result.invokedSkills.has('stale-skill')).toBe(false);
    expect(result.invokedSkills.has('fresh-skill')).toBe(true);
    expect(result.sessionsInWindow).toBe(3);
  });

  it('sets dataAvailable=false when fewer than 3 sessions are in window', async () => {
    await writeSession('proj-a', 's1', ['init']);
    await writeSession('proj-a', 's2', ['commit']);

    const result = await scanSessionUsage(60);

    expect(result.invokedSkills.size).toBe(2);
    expect(result.sessionsInWindow).toBe(2);
    expect(result.dataAvailable).toBe(false);
  });

  it('sets dataAvailable=false when invocation set is empty (suspect schema drift)', async () => {
    // Three sessions but none invoke Skill — could be schema change or
    // a user who genuinely never uses skills. Either way, we must not
    // flag every skill as unused.
    await writeSession('proj-a', 's1', []);
    await writeSession('proj-a', 's2', []);
    await writeSession('proj-a', 's3', []);

    const result = await scanSessionUsage(60);

    expect(result.invokedSkills.size).toBe(0);
    expect(result.sessionsInWindow).toBe(3);
    expect(result.dataAvailable).toBe(false);
  });

  // Inject a cache file directly so we can prove cache-hit behavior without
  // fighting filesystem mtime precision (Date round-trips through `utimes`
  // can lose nanosecond precision on APFS, breaking strict mtimeMs equality).
  it('honors cached skills when cached mtimeMs matches the file', async () => {
    const filePath = await writeSession('proj-a', 's1', ['real-content']);
    await writeSession('proj-a', 's2', ['commit']);
    await writeSession('proj-a', 's3', ['init']);

    const { mtimeMs } = await stat(filePath);
    const cachePath = join(tmp.claudeDir, '.skill-usage-cache.json');
    // Cache claims s1 contains 'from-cache'; the file actually has 'real-content'.
    // If the cache is honored, scan sees 'from-cache' and not 'real-content'.
    // Include v2.6 extension fields so the entry is not treated as stale.
    await writeFile(cachePath, JSON.stringify({
      version: 1,
      entries: {
        [filePath]: { mtimeMs, skills: ['from-cache'], mcpPrefixes: [], commands: [], invocationCount: 1 },
      },
    }));

    const result = await scanSessionUsage(60);
    expect(result.invokedSkills.has('from-cache')).toBe(true);
    expect(result.invokedSkills.has('real-content')).toBe(false);
  });

  it('invalidates cache entry when mtime no longer matches', async () => {
    const filePath = await writeSession('proj-a', 's1', ['original']);
    await writeSession('proj-a', 's2', ['commit']);
    await writeSession('proj-a', 's3', ['third']);

    const { mtimeMs } = await stat(filePath);
    const cachePath = join(tmp.claudeDir, '.skill-usage-cache.json');
    // Cache mtime is older than the file — must be re-parsed.
    await writeFile(cachePath, JSON.stringify({
      version: 1,
      entries: {
        [filePath]: { mtimeMs: mtimeMs - 5000, skills: ['stale-cache'] },
      },
    }));

    const result = await scanSessionUsage(60);
    expect(result.invokedSkills.has('original')).toBe(true);
    expect(result.invokedSkills.has('stale-cache')).toBe(false);
  });
});
