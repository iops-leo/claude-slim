import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { writeFile, utimes, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scanMemoryFiles } from '../scanner/memory.js';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, writeStaleProject, type TmpClaude } from './helpers/tmp-claude.js';

/**
 * A project whose memory files have not changed in 90 days but which had a
 * session yesterday is in use. Judging staleness by memory mtimes alone
 * offered to park the memory of a project the user works in every day.
 */

const DAY = 86_400_000;
let tmp: TmpClaude;

beforeAll(async () => { await initTokenizer(); });
beforeEach(async () => { tmp = await createTmpClaude(); });
afterEach(async () => { await tmp.cleanup(); });

async function age(path: string, days: number): Promise<void> {
  const t = new Date(Date.now() - days * DAY);
  await utimes(path, t, t);
}

async function oldMemoryProject(slug: string): Promise<string> {
  const memDir = await writeStaleProject(tmp.projectsDir, slug, { 'MEMORY.md': '# idx', 'topic.md': 'x' });
  for (const f of await readdir(memDir)) await age(join(memDir, f), 200);
  return join(tmp.projectsDir, slug);
}

describe('stale_project respects session activity', () => {
  it('is not stale when a session log in the project is recent', async () => {
    const proj = await oldMemoryProject('-Users-me-active');
    await writeFile(join(proj, 'sess.jsonl'), '{}\n');
    await age(join(proj, 'sess.jsonl'), 2);
    const { staleProjects } = await scanMemoryFiles();
    expect(staleProjects).toEqual([]);
  });

  it('is stale when both memory and sessions are old', async () => {
    const proj = await oldMemoryProject('-Users-me-gone');
    await writeFile(join(proj, 'sess.jsonl'), '{}\n');
    await age(join(proj, 'sess.jsonl'), 120);
    const { staleProjects } = await scanMemoryFiles();
    expect(staleProjects.map((s) => s.project)).toEqual(['-Users-me-gone']);
    expect(staleProjects[0].ageDays).toBe(120);
  });

  it('is stale with old memory and no sessions at all', async () => {
    await oldMemoryProject('-Users-me-quiet');
    const { staleProjects } = await scanMemoryFiles();
    expect(staleProjects.map((s) => s.project)).toEqual(['-Users-me-quiet']);
  });
});
