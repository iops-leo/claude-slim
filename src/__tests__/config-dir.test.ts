import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { join, resolve } from 'node:path';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';
import { getClaudeDir, getConfigDirOverride, looksLikeToolInstallDir } from '../paths.js';
import { removeMcpServer } from '../mcp-runtime.js';
import { detectInstallMethod } from '../update-check.js';
import { getClaudeJsonPath, readSettingsSources } from '../scanner/settings-sources.js';
import { resolveProjectMemory } from '../scanner/project-memory.js';
import { scanMcpServers } from '../scanner/mcp.js';
import { scanLocalSkills } from '../scanner/local-skills.js';

/**
 * CLAUDE_CONFIG_DIR moves everything under ~/.claude — and .claude.json —
 * to another directory (https://code.claude.com/docs/en/claude-directory.md).
 * Pre-2.16.2 claude-slim always read ~/.claude, so a user running a second
 * profile had the wrong one measured and cleaned.
 */
describe('CLAUDE_CONFIG_DIR', () => {
  let tmp: TmpClaude;
  let profile: string;
  beforeAll(async () => { await initTokenizer(); });
  beforeEach(async () => {
    tmp = await createTmpClaude();
    profile = join(tmp.home, '.claude-work');
    await mkdir(join(profile, 'skills'), { recursive: true });
  });
  afterEach(async () => { await tmp.cleanup(); });

  it('is unset by default and falls back to ~/.claude and ~/.claude.json', () => {
    expect(getConfigDirOverride()).toBeUndefined();
    expect(getClaudeDir()).toBe(join(tmp.home, '.claude'));
    expect(getClaudeJsonPath()).toBe(join(tmp.home, '.claude.json'));
  });

  it('moves the claude dir and .claude.json', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', profile);
    expect(getClaudeDir()).toBe(profile);
    expect(getClaudeJsonPath()).toBe(join(profile, '.claude.json'));
  });

  it('takes the value as Claude Code does: no ~ expansion, no trimming, relative to cwd', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '~/.claude-work');
    expect(getClaudeDir()).toBe(resolve('~/.claude-work'));
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/srv/work ');
    expect(getClaudeDir()).toBe('/srv/work ');
  });

  it('hands spawned `claude` processes the same absolute profile, whatever their cwd', async () => {
    const bin = join(tmp.home, 'bin');
    const out = join(tmp.home, 'seen.txt');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'claude'), `#!/bin/sh\nprintf '%s' "$CLAUDE_CONFIG_DIR" > '${out}'\n`);
    await chmod(join(bin, 'claude'), 0o755);
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
    vi.stubEnv('CLAUDE_CONFIG_DIR', 'profiles/work'); // relative
    await removeMcpServer('x', 'user', tmp.home); // child runs in a different cwd
    expect(await readFile(out, 'utf-8')).toBe(resolve('profiles/work'));
  });

  it('recognises a plugin install under the configured profile', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/srv/work');
    expect(detectInstallMethod('/srv/work/plugins/cache/claude-slim/claude-slim/2.16.2/dist/cli.js')).toBe('plugin');
    expect(looksLikeToolInstallDir('/srv/work/plugins/cache/claude-slim/claude-slim/2.16.2')).toBe(true);
  });

  it('scans that profile\'s skills, settings and MCP servers, not the default ones', async () => {
    await mkdir(join(tmp.skillsDir, 'default-skill'), { recursive: true });
    await writeFile(join(tmp.skillsDir, 'default-skill', 'SKILL.md'), '---\nname: d\n---\n');
    await mkdir(join(profile, 'skills', 'work-skill'), { recursive: true });
    await writeFile(join(profile, 'skills', 'work-skill', 'SKILL.md'), '---\nname: w\n---\n');
    await writeFile(join(tmp.home, '.claude.json'), JSON.stringify({ mcpServers: { personal: {} } }));
    await writeFile(join(profile, '.claude.json'), JSON.stringify({ mcpServers: { work: {} } }));
    vi.stubEnv('CLAUDE_CONFIG_DIR', profile);

    expect((await scanLocalSkills()).skills.map((s) => s.name)).toEqual(['work-skill']);
    const mcp = await scanMcpServers(join(tmp.home, 'code'), { managedDir: join(tmp.home, 'managed') });
    expect(mcp.names).toEqual(['work']);
  });

  it('uses CLAUDE_CODE_PROJECT_DIR_NAME as the memory project folder when set beside it', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', profile);
    vi.stubEnv('CLAUDE_CODE_PROJECT_DIR_NAME', 'work');
    const m = await resolveProjectMemory(await readSettingsSources(join(tmp.home, 'code', 'any')));
    expect(m.slug).toBe('work');
  });

  it('ignores CLAUDE_CODE_PROJECT_DIR_NAME without CLAUDE_CONFIG_DIR', async () => {
    vi.stubEnv('CLAUDE_CODE_PROJECT_DIR_NAME', 'work');
    const dir = join(tmp.home, 'code', 'any');
    expect((await resolveProjectMemory(await readSettingsSources(dir))).slug).not.toBe('work');
  });

  it.each(['../escape', 'work.prod', 'con', 'LPT1', 'a'.repeat(65), 'has space'])(
    'falls back to the derived name for an invalid project dir name %s',
    async (bad) => {
      vi.stubEnv('CLAUDE_CONFIG_DIR', profile);
      vi.stubEnv('CLAUDE_CODE_PROJECT_DIR_NAME', bad);
      const dir = join(tmp.home, 'code', 'any');
      expect((await resolveProjectMemory(await readSettingsSources(dir))).slug).toBe(dir.replace(/[^A-Za-z0-9]/g, '-'));
    },
  );

  it('treats the directory holding the configured .claude as the configuration home', async () => {
    // CLAUDE_CONFIG_DIR=/x/.claude makes /x the configuration home, where an
    // untrusted settings.local.json still counts.
    const cfgHome = join(tmp.home, 'cfg-home');
    await mkdir(join(cfgHome, '.claude'), { recursive: true });
    await writeFile(join(cfgHome, '.mcp.json'), JSON.stringify({ mcpServers: { p: {} } }));
    await writeFile(join(cfgHome, '.claude', 'settings.local.json'), JSON.stringify({ enabledMcpjsonServers: ['p'] }));
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(cfgHome, '.claude'));
    const r = await scanMcpServers(cfgHome, { managedDir: join(tmp.home, 'managed') });
    expect(r.servers.find((s) => s.name === 'p')?.status).toBe('active');
  });

  it('drops the configuration-home exception when the local file moved to a repo root', async () => {
    const repo = join(tmp.home, 'repo');
    const sub = join(repo, 'sub');
    await mkdir(join(repo, '.git'), { recursive: true });
    await mkdir(join(repo, '.claude'), { recursive: true });
    await mkdir(join(sub, '.claude'), { recursive: true });
    await writeFile(join(sub, '.mcp.json'), JSON.stringify({ mcpServers: { p: {} } }));
    await writeFile(join(repo, '.claude', 'settings.local.json'), JSON.stringify({ enabledMcpjsonServers: ['p'] }));
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(sub, '.claude'));
    const r = await scanMcpServers(sub, { managedDir: join(tmp.home, 'managed') });
    expect(r.servers.find((s) => s.name === 'p')?.status).toBe('pending');
  });
});
