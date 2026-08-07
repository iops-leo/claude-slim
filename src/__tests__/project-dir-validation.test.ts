import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { projectDirError } from '../paths.js';
import { scan } from '../scanner/index.js';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, writeStaleProject, type TmpClaude } from './helpers/tmp-claude.js';

// `scan()` shells out to `claude plugin list` twice per call. Each spawn costs
// 300-500ms, so the several scans below eat most of the 5s budget and the file
// times out on a loaded machine. Same stub, and same reasoning, as
// scan-stdout-invariant.test.ts: this tmp ~/.claude has no plugins installed,
// so an empty plugin list is the honest fixture. Everything else stays real.
vi.mock('../scanner/fs-walk.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scanner/fs-walk.js')>()),
  runCommand: async () => '',
}));


/**
 * Regression guard for the silent zero returning through its own fix.
 *
 * v2.12.1 added `--project-dir` because a wrong cwd zeroed project memory
 * without saying so. But the slug is a pure string transform, so a typo'd
 * `--project-dir /projct/app` produced a well-formed slug matching nothing and
 * reported 0 with exit code 0 — the same failure, through the new flag.
 */

let tmp: TmpClaude;

beforeAll(async () => { await initTokenizer(); });
beforeEach(async () => { tmp = await createTmpClaude(); });
afterEach(async () => { await tmp.cleanup(); });

describe('projectDirError', () => {
  it('rejects a path that does not exist', () => {
    expect(projectDirError('/nope/does/not/exist')).toMatch(/not an existing directory/);
  });

  it('rejects a file', async () => {
    const f = join(tmp.home, 'a-file.txt');
    await writeFile(f, 'x');
    expect(projectDirError(f)).toMatch(/not a directory/);
  });

  it('accepts a real directory', () => {
    expect(projectDirError(tmp.home)).toBeNull();
  });

  it('accepts a real directory that happens to have no memory', () => {
    // An existing project with nothing stored is a true zero, not an error.
    expect(projectDirError(tmp.claudeDir)).toBeNull();
  });
});

describe('scan — currentProjectKnown', () => {
  it('is true when the project exists on disk', async () => {
    await writeStaleProject(tmp.projectsDir, '-Users-me-app', { 'MEMORY.md': 'notes' });
    const result = await scan({ projectDir: '/Users/me/app' });
    expect(result.currentProjectKnown).toBe(true);
    expect(result.currentProjectMemoryTokens).toBeGreaterThan(0);
  });

  it('is true for a known project whose memory is empty — a real zero', async () => {
    await mkdir(join(tmp.projectsDir, '-Users-me-empty'), { recursive: true });
    const result = await scan({ projectDir: '/Users/me/empty' });
    expect(result.currentProjectKnown).toBe(true);
    expect(result.currentProjectMemoryTokens).toBe(0);
  });

  it('is false when Claude holds no state for the slug', async () => {
    await writeStaleProject(tmp.projectsDir, '-Users-me-real', { 'MEMORY.md': 'notes' });
    const result = await scan({ projectDir: '/Users/me/typo' });
    expect(result.currentProjectKnown).toBe(false);
    expect(result.currentProjectMemoryTokens).toBe(0);
    // The distinction the flag exists to make: memory does exist on this
    // machine, just not under this slug, so the 0 may be answering the wrong
    // question. The JSON now says which kind of 0 it is.
    expect(result.allProjectsMemoryTokens).toBeGreaterThan(0);
  });
});
