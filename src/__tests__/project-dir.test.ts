import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { join } from 'node:path';
import { looksLikeToolInstallDir, getCurrentProjectSlug } from '../paths.js';
import { scan } from '../scanner/index.js';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, writeStaleProject, type TmpClaude } from './helpers/tmp-claude.js';

/**
 * Regression guard for a silent zero.
 *
 * The `/claude-slim` skill used to invoke the CLI with
 * `cd "${CLAUDE_PLUGIN_ROOT}" && node dist/cli.js scan`. That made
 * `process.cwd()` the plugin cache directory, so the project slug resolved
 * there, matched no project memory, and the startup estimate quietly dropped
 * every project-memory token — 108,570 of them on the machine where this was
 * caught, through the tool's primary entry point.
 */

let tmp: TmpClaude;

beforeAll(async () => {
  await initTokenizer();
});

beforeEach(async () => {
  tmp = await createTmpClaude();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await tmp.cleanup();
});

describe('looksLikeToolInstallDir', () => {
  it('recognises a Claude Code plugin cache directory', () => {
    expect(looksLikeToolInstallDir('/Users/me/.claude/plugins/cache/claude-slim/claude-slim/2.12.0')).toBe(true);
  });

  it('recognises an npx cache', () => {
    expect(looksLikeToolInstallDir('/Users/me/.npm/_npx/abc123/node_modules/claude-slim')).toBe(true);
  });

  it('recognises a node_modules install', () => {
    expect(looksLikeToolInstallDir('/srv/app/node_modules/claude-slim')).toBe(true);
  });

  it('does not flag an ordinary project directory', () => {
    for (const p of ['/Users/me/project/app', '/Users/me/.claude', '/tmp/work', '/']) {
      expect(looksLikeToolInstallDir(p)).toBe(false);
    }
  });

  it('does not flag a project that merely mentions the tool name', () => {
    // Someone developing claude-slim itself is in a normal working directory.
    expect(looksLikeToolInstallDir('/Users/me/project/claude-slim')).toBe(false);
  });
});

describe('scan — projectDir decides which memory counts', () => {
  it('attributes memory to the directory passed in, not to cwd', async () => {
    await writeStaleProject(tmp.projectsDir, '-Users-me-active', {
      'MEMORY.md': 'Substantial project memory. '.repeat(300),
    });

    // Simulate the skill's old behaviour: cwd is the plugin install.
    vi.spyOn(process, 'cwd').mockReturnValue(
      join(tmp.home, '.claude', 'plugins', 'cache', 'claude-slim', 'claude-slim', '2.12.0'),
    );

    const withoutDir = await scan();
    const withDir = await scan({ projectDir: '/Users/me/active' });

    // The bug: from the install directory, project memory silently vanishes.
    expect(withoutDir.currentProjectMemoryTokens).toBe(0);
    // The fix: naming the project restores it.
    expect(withDir.currentProjectMemoryTokens).toBeGreaterThan(0);
    expect(withDir.currentProjectSlug).toBe('-Users-me-active');
    expect(withDir.totalTokensBefore).toBeGreaterThan(withoutDir.totalTokensBefore);
  });

  it('still defaults to cwd when no directory is given', async () => {
    await writeStaleProject(tmp.projectsDir, '-Users-me-here', { 'a.md': 'content here' });
    vi.spyOn(process, 'cwd').mockReturnValue('/Users/me/here');

    const result = await scan();
    expect(result.currentProjectSlug).toBe('-Users-me-here');
    expect(result.currentProjectMemoryTokens).toBeGreaterThan(0);
  });

  it('reports zero for a project directory with no memory, without error', async () => {
    await writeStaleProject(tmp.projectsDir, '-Users-me-other', { 'a.md': 'content' });
    const result = await scan({ projectDir: '/Users/me/empty' });
    expect(result.currentProjectSlug).toBe('-Users-me-empty');
    expect(result.currentProjectMemoryTokens).toBe(0);
    // The other project's memory is still listed, just not attributed.
    expect(result.allProjectsMemoryTokens).toBeGreaterThan(0);
  });

  it('normalises a relative projectDir the same way the slug format expects', async () => {
    expect(getCurrentProjectSlug('/Users/me/app/../app')).toBe('-Users-me-app');
  });
});
