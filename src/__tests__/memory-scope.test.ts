import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { scan } from '../scanner/index.js';
import { getCurrentProjectSlug } from '../paths.js';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, writeStaleProject, type TmpClaude } from './helpers/tmp-claude.js';

// See scan-stdout-invariant.test.ts: `scan()` spawns `claude plugin list` twice
// per call, and these tests call it four times. Stubbing the spawn keeps the
// suite deterministic instead of hostage to how fast an external CLI starts.
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

describe('getCurrentProjectSlug', () => {
  it('maps an absolute path to the Claude Code project slug', () => {
    expect(getCurrentProjectSlug('/Users/me/app')).toBe('-Users-me-app');
  });

  it('normalises a relative segment before slugifying', () => {
    expect(getCurrentProjectSlug('/Users/me/app/../app')).toBe('-Users-me-app');
  });

  it('handles the filesystem root', () => {
    expect(getCurrentProjectSlug('/')).toBe('-');
  });
});

describe('startup estimate counts only the current project memory', () => {
  it('excludes other projects memory from totalTokensBefore', async () => {
    const bigBody = 'This is a stored project memory note. '.repeat(200);
    const smallBody = 'Small note for the active project.';

    await writeStaleProject(tmp.projectsDir, '-Users-me-active', {
      'note.md': smallBody,
    });
    await writeStaleProject(tmp.projectsDir, '-Users-me-other-one', {
      'note.md': bigBody,
    });
    await writeStaleProject(tmp.projectsDir, '-Users-me-other-two', {
      'note.md': bigBody,
    });

    vi.spyOn(process, 'cwd').mockReturnValue('/Users/me/active');
    const result = await scan();

    expect(result.currentProjectSlug).toBe('-Users-me-active');

    // Every project's memory is still listed and available for stale-project
    // cleanup — only the startup arithmetic is scoped.
    expect(result.memoryFiles).toHaveLength(3);
    expect(result.allProjectsMemoryTokens).toBeGreaterThan(
      result.currentProjectMemoryTokens * 10,
    );

    // The headline number must not absorb the two unrelated projects.
    expect(result.totalTokensBefore).toBeLessThan(result.allProjectsMemoryTokens);
    expect(result.totalTokensBefore).toBeGreaterThanOrEqual(
      result.currentProjectMemoryTokens,
    );
  });

  it('reports zero current-project memory when run outside any known project', async () => {
    await writeStaleProject(tmp.projectsDir, '-Users-me-somewhere', {
      'note.md': 'content that belongs to another project',
    });

    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/unrelated-dir');
    const result = await scan();

    expect(result.currentProjectMemoryTokens).toBe(0);
    expect(result.allProjectsMemoryTokens).toBeGreaterThan(0);
  });

  it('sums every memory file belonging to the active project', async () => {
    await writeStaleProject(tmp.projectsDir, '-Users-me-active', {
      'a.md': 'first memory file',
      'b.md': 'second memory file',
    });

    vi.spyOn(process, 'cwd').mockReturnValue('/Users/me/active');
    const result = await scan();

    const expected = result.memoryFiles
      .filter((m) => m.project === '-Users-me-active')
      .reduce((s, m) => s + m.tokens, 0);
    expect(result.currentProjectMemoryTokens).toBe(expected);
    expect(result.currentProjectMemoryTokens).toBeGreaterThan(0);
  });

  it('adds agent and command listing cost to the startup estimate', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const agentsDir = join(tmp.claudeDir, 'agents');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, 'helper.md'),
      '---\ndescription: A helper agent with a reasonably descriptive summary line.\n---\nbody',
    );

    vi.spyOn(process, 'cwd').mockReturnValue('/Users/me/active');
    const result = await scan();

    expect(result.userAgents).toHaveLength(1);
    expect(result.totalTokensBefore).toBeGreaterThanOrEqual(
      result.userAgents[0].listingTokens,
    );
  });
});
