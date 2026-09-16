import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { scan } from '../scanner/index.js';
import { memoryIndexStartupSlice } from '../scanner/memory.js';
import { classifyIssues } from '../scanner/detectors.js';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, writeStaleProject, type TmpClaude } from './helpers/tmp-claude.js';
import type { MemoryFile } from '../types.js';

vi.mock('../scanner/fs-walk.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scanner/fs-walk.js')>()),
  runCommand: async () => '',
}));

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
  await initTokenizer();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await tmp.cleanup();
});

// Claude Code loads only the first 200 lines / 25KB of MEMORY.md at startup.
// Topic files are read on demand. Source: code.claude.com/docs/en/memory.md.
describe('memoryIndexStartupSlice', () => {
  it('returns the whole file when under both caps', () => {
    const { text, truncated } = memoryIndexStartupSlice('a\nb\nc\n');
    expect(text).toBe('a\nb\nc\n');
    expect(truncated).toBe(false);
  });

  it('cuts at 200 lines', () => {
    const content = Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n');
    const { text, truncated } = memoryIndexStartupSlice(content);
    expect(text.split('\n')).toHaveLength(200);
    expect(truncated).toBe(true);
  });

  it('cuts at 25KB even when under 200 lines', () => {
    const content = 'x'.repeat(30 * 1024);
    const { text, truncated } = memoryIndexStartupSlice(content);
    expect(Buffer.byteLength(text)).toBe(25 * 1024);
    expect(truncated).toBe(true);
  });

  it('does not tear a multibyte character at the byte cap', () => {
    const content = '한'.repeat(10 * 1024); // 3 bytes each, 30KB
    const { text, truncated } = memoryIndexStartupSlice(content);
    expect(truncated).toBe(true);
    expect(text.includes('\uFFFD')).toBe(false);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(25 * 1024);
    expect(Buffer.byteLength(text)).toBeGreaterThan(25 * 1024 - 3);
  });

  it('does not count a trailing newline as a 201st line', () => {
    const content = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n';
    expect(memoryIndexStartupSlice(content).truncated).toBe(false);
  });
});

describe('startup estimate counts only the MEMORY.md index', () => {
  it('excludes topic files from currentProjectMemoryTokens', async () => {
    const topic = 'A long topic note that is read on demand. '.repeat(300);
    await writeStaleProject(tmp.projectsDir, '-Users-me-active', {
      'MEMORY.md': '- [Topic](topic.md) — pointer line',
      'topic.md': topic,
    });

    vi.spyOn(process, 'cwd').mockReturnValue('/Users/me/active');
    const result = await scan();

    const index = result.memoryFiles.find((m) => m.name === 'MEMORY.md')!;
    const topicFile = result.memoryFiles.find((m) => m.name === 'topic.md')!;
    expect(index.isIndex).toBe(true);
    expect(topicFile.isIndex).toBe(false);
    expect(topicFile.startupTokens).toBe(0);
    expect(topicFile.tokens).toBeGreaterThan(0);
    expect(result.currentProjectMemoryTokens).toBe(index.startupTokens);
    expect(result.currentProjectMemoryTokens).toBeLessThan(topicFile.tokens);
  });

  it('caps MEMORY.md at the startup slice and flags truncation', async () => {
    const big = Array.from({ length: 400 }, (_, i) => `- [m${i}](m${i}.md) — hook`).join('\n');
    await writeStaleProject(tmp.projectsDir, '-Users-me-active', { 'MEMORY.md': big });

    vi.spyOn(process, 'cwd').mockReturnValue('/Users/me/active');
    const result = await scan();

    const index = result.memoryFiles.find((m) => m.name === 'MEMORY.md')!;
    expect(index.truncated).toBe(true);
    expect(index.startupTokens).toBeLessThan(index.tokens);
    expect(result.currentProjectMemoryTokens).toBe(index.startupTokens);
  });

  it('reports zero startup memory for a project with only topic files', async () => {
    await writeStaleProject(tmp.projectsDir, '-Users-me-active', {
      'note.md': 'on-demand note',
    });
    vi.spyOn(process, 'cwd').mockReturnValue('/Users/me/active');
    const result = await scan();
    expect(result.currentProjectMemoryTokens).toBe(0);
    expect(result.allProjectsMemoryTokens).toBeGreaterThan(0);
  });
});

describe('oversized_memory detector', () => {
  const mem = (name: string, sizeBytes: number, extra: Partial<MemoryFile> = {}): MemoryFile => ({
    project: '-Users-me-app',
    name,
    path: `/p/app/memory/${name}`,
    sizeBytes,
    tokens: Math.round(sizeBytes / 4),
    isIndex: name === 'MEMORY.md',
    startupTokens: name === 'MEMORY.md' ? Math.round(sizeBytes / 4) : 0,
    truncated: false,
    ...extra,
  });

  const run = (memoryFiles: MemoryFile[]) =>
    classifyIssues({
      localSkills: [], pluginSkills: [], brokenSymlinks: [], memoryFiles,
      tempCaches: [], staleProjects: [], disabledPlugins: new Set(), plugins: [],
      contents: new Map(), recentSkillInvocations: new Set(), sessionDataAvailable: false,
      lookbackDays: 60, pluginSurfaces: [], enabledPlugins: [],
      recentMcpPrefixes: new Set(), recentCommands: new Set(),
      totalUserCallableInvocations: 0, sessionsInWindow: 0, pluginCosts: new Map(),
    }).filter((i) => i.type === 'oversized_memory');

  it('ignores a large topic file — it costs nothing at startup', () => {
    expect(run([mem('big_topic.md', 40_000)])).toHaveLength(0);
  });

  it('flags a large MEMORY.md with its startup tokens', () => {
    const issues = run([mem('MEMORY.md', 8_000)]);
    expect(issues).toHaveLength(1);
    expect(issues[0].tokens).toBe(2000);
  });

  it('names truncation when the index exceeds the startup cap', () => {
    const issues = run([mem('MEMORY.md', 30_000, { truncated: true, startupTokens: 6400 })]);
    expect(issues[0].detail).toMatch(/truncat/i);
    expect(issues[0].tokens).toBe(6400);
  });
});

describe('stale_project tokens', () => {
  it('sums startup tokens, not every topic file', async () => {
    const memDir = await writeStaleProject(tmp.projectsDir, '-Users-me-old', {
      'MEMORY.md': '- [t](t.md) — hook',
      't.md': 'topic body '.repeat(500),
    });
    const { utimes } = await import('node:fs/promises');
    const old = new Date(Date.now() - 120 * 24 * 3600 * 1000);
    await utimes(join(memDir, 'MEMORY.md'), old, old);
    await utimes(join(memDir, 't.md'), old, old);

    vi.spyOn(process, 'cwd').mockReturnValue('/Users/me/old');
    const result = await scan();
    const stale = result.issues.find((i) => i.type === 'stale_project')!;
    const index = result.memoryFiles.find((m) => m.name === 'MEMORY.md')!;
    expect(stale).toBeDefined();
    expect(stale.tokens).toBe(index.startupTokens);
  });
});
