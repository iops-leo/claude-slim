import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { readFile, writeFile, stat, readdir, mkdir, symlink } from 'node:fs/promises';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';
import type { DetectorContext } from '../scanner/detectors.js';
import type { McpServerEntry } from '../scanner/mcp.js';
import type { Issue, DisabledMcpEntry } from '../types.js';

vi.mock('../mcp-runtime.js', async (orig) => {
  const actual = await orig<typeof import('../mcp-runtime.js')>();
  return { ...actual, removeMcpServer: vi.fn(), addMcpServerJson: vi.fn() };
});

const runtime = await import('../mcp-runtime.js');
const { detectors } = await import('../scanner/detectors.js');
const { extractMcpPrefixesFromTranscript } = await import('../scanner/sessions.js');
const { disableUnusedMcp, restoreMcpServer } = await import('../mcp-cleanup.js');
const { readManifestV2 } = await import('../manifest.js');

const removeMock = vi.mocked(runtime.removeMcpServer);
const addMock = vi.mocked(runtime.addMcpServerJson);

function entry(name: string, scope: McpServerEntry['scope'], status: McpServerEntry['status'] = 'active'): McpServerEntry {
  return { name, scope, status, path: '/x/.claude.json', toolPrefix: name.replace(/[^A-Za-z0-9_-]/g, '_') };
}

function ctx(over: Partial<DetectorContext>): DetectorContext {
  return {
    localSkills: [], pluginSkills: [], brokenSymlinks: [], memoryFiles: [], tempCaches: [],
    staleProjects: [], disabledPlugins: new Set(), plugins: [], contents: new Map(),
    recentSkillInvocations: new Set(), sessionDataAvailable: true, lookbackDays: 60,
    pluginSurfaces: [], enabledPlugins: [], recentMcpPrefixes: new Set(), recentCommands: new Set(),
    totalUserCallableInvocations: 50, sessionsInWindow: 20, pluginCosts: new Map(),
    mcpServers: [], mcpProjectKey: '/repo', claudeJsonPath: '/home/.claude.json',
    ...over,
  };
}

const unusedMcp = detectors.find((d) => d.name === 'unused_mcp')!;

describe('unused_mcp detector', () => {
  it('flags user and local servers whose tools were never called', () => {
    const issues = unusedMcp.detect(ctx({
      mcpServers: [entry('pencil', 'user'), entry('magic', 'user'), entry('here', 'local'), entry('claude.ai x', 'user')],
      recentMcpPrefixes: new Set(['magic', 'claude_ai_x']),
    }));
    expect(issues.map((i) => [i.name, i.mcpScope, i.path, i.tier])).toEqual([
      ['pencil', 'user', '/home/.claude.json', 3],
      ['here', 'local', '/repo', 3],
    ]);
    expect(issues[0].tokens).toBeGreaterThan(0);
  });

  it('leaves project, managed, pending and blocked servers alone', () => {
    const issues = unusedMcp.detect(ctx({
      mcpServers: [entry('p', 'project'), entry('m', 'managed'), entry('b', 'user', 'blocked')],
    }));
    expect(issues).toEqual([]);
  });

  it.each([
    ['my__srv', 'mcp__my__srv__query'],
    ['srv_', 'mcp__srv___query'],
    ['__lead', 'mcp____lead__query'],
  ])('treats %s as used when %s was called', (name, toolName) => {
    const recorded = extractMcpPrefixesFromTranscript(
      JSON.stringify({ message: { content: [{ type: 'tool_use', name: toolName }] } }),
    );
    const issues = unusedMcp.detect(ctx({ mcpServers: [entry(name, 'user')], recentMcpPrefixes: recorded }));
    expect(issues).toEqual([]);
  });

  it('says nothing without enough session history', () => {
    expect(unusedMcp.detect(ctx({ mcpServers: [entry('a', 'user')], sessionsInWindow: 2 }))).toEqual([]);
    expect(unusedMcp.detect(ctx({ mcpServers: [entry('a', 'user')], totalUserCallableInvocations: 0 }))).toEqual([]);
  });
});

describe('disableUnusedMcp / restoreMcpServer', () => {
  let tmp: TmpClaude;
  const config = { type: 'stdio', command: 'npx', args: ['-y', 'srv'], env: { TOKEN: 'secret' } };

  beforeEach(async () => {
    tmp = await createTmpClaude();
    removeMock.mockReset().mockResolvedValue(undefined);
    addMock.mockReset().mockResolvedValue(undefined);
    await writeFile(join(tmp.home, '.claude.json'), JSON.stringify({
      mcpServers: { pencil: config },
      projects: { '/repo': { mcpServers: { here: { type: 'http', url: 'https://h' } } } },
    }));
  });
  afterEach(async () => { await tmp.cleanup(); });

  function issue(name: string, scope: 'user' | 'local', path: string): Issue {
    return { type: 'unused_mcp', tier: 3, name, tokens: 80, path, mcpScope: scope };
  }

  async function backups(): Promise<string[]> {
    try { return await readdir(join(tmp.disabledDir, '.mcp-backup')); } catch { return []; }
  }

  it('backs up the definition privately, removes it through the CLI, and records it', async () => {
    await disableUnusedMcp(issue('pencil', 'user', join(tmp.home, '.claude.json')));

    expect(removeMock).toHaveBeenCalledWith('pencil', 'user', tmp.home);
    const m = await readManifestV2();
    const e = m.entries[0] as DisabledMcpEntry;
    expect(e).toMatchObject({ type: 'unused_mcp', name: 'pencil', scope: 'user', cwd: tmp.home });
    // Outside the skill-name namespace: a disabled skill called `mcp-backup`
    // lives at skills.disabled/mcp-backup/ and must never hold these files.
    expect(e.backupPath.startsWith(join(tmp.disabledDir, '.mcp-backup') + '/')).toBe(true);
    const backup = JSON.parse(await readFile(e.backupPath, 'utf-8'));
    expect(backup.config).toEqual(config);
    expect((await stat(e.backupPath)).mode & 0o777).toBe(0o600);
    // The secret lives only in the 0600 backup, never in the shared manifest.
    expect(JSON.stringify(m)).not.toContain('secret');
  });

  it('runs local-scope removal from the project directory', async () => {
    await disableUnusedMcp(issue('here', 'local', '/repo'));
    expect(removeMock).toHaveBeenCalledWith('here', 'local', '/repo');
  });

  it('refuses when the definition is no longer in ~/.claude.json', async () => {
    await expect(disableUnusedMcp(issue('gone', 'user', ''))).rejects.toThrow(/not found/);
    expect(removeMock).not.toHaveBeenCalled();
    expect(await backups()).toEqual([]);
  });

  it('deletes the backup and records nothing when removal fails', async () => {
    removeMock.mockRejectedValueOnce(new Error('No MCP server named "pencil"'));
    await expect(disableUnusedMcp(issue('pencil', 'user', ''))).rejects.toThrow();
    expect((await readManifestV2()).entries).toEqual([]);
    expect(await backups()).toEqual([]);
  });

  it('restores the exact definition and clears the record and backup', async () => {
    await disableUnusedMcp(issue('pencil', 'user', ''));
    const e = (await readManifestV2()).entries[0] as DisabledMcpEntry;

    await restoreMcpServer(e);

    expect(addMock).toHaveBeenCalledWith('pencil', 'user', config, tmp.home);
    expect((await readManifestV2()).entries).toEqual([]);
    expect(await backups()).toEqual([]);
  });

  it('keeps the record and backup when the restore command fails', async () => {
    await disableUnusedMcp(issue('pencil', 'user', ''));
    const e = (await readManifestV2()).entries[0] as DisabledMcpEntry;
    addMock.mockRejectedValueOnce(new Error('MCP server pencil already exists in user config'));

    await expect(restoreMcpServer(e)).rejects.toThrow(/already exists/);
    expect((await readManifestV2()).entries).toHaveLength(1);
    expect(await backups()).toHaveLength(1);
  });

  it('refuses a manifest entry whose backup lives outside the backup store, symlinks included', async () => {
    const outside = join(tmp.home, 'elsewhere');
    await mkdir(outside, { recursive: true });
    const payload = JSON.stringify({ name: 'pencil', scope: 'user', cwd: tmp.home, config: {} });
    await writeFile(join(outside, 'saved.json'), payload);
    await mkdir(join(tmp.disabledDir, '.mcp-backup'), { recursive: true });
    await symlink(outside, join(tmp.disabledDir, '.mcp-backup', 'link'));
    const base = { type: 'unused_mcp' as const, name: 'pencil', scope: 'user' as const, cwd: tmp.home, disabledAt: '' };

    await expect(restoreMcpServer({ ...base, backupPath: join(outside, 'saved.json') })).rejects.toThrow(/outside/);
    await expect(
      restoreMcpServer({ ...base, backupPath: join(tmp.disabledDir, '.mcp-backup', 'link', 'saved.json') }),
    ).rejects.toThrow(/outside/);
    expect(addMock).not.toHaveBeenCalled();
    expect(await readFile(join(outside, 'saved.json'), 'utf-8')).toBe(payload);
  });

  it('refuses a name two raw server names sanitize to', async () => {
    await writeFile(join(tmp.home, '.claude.json'), JSON.stringify({
      mcpServers: { server: { command: 'used' }, 'server\u200B': { command: 'unused' } },
    }));
    await expect(disableUnusedMcp(issue('server', 'user', ''))).rejects.toThrow(/ambiguous/);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('backs up from $CLAUDE_CONFIG_DIR/.claude.json — the file the CLI it runs will edit', async () => {
    const profile = join(tmp.home, 'work-profile');
    await mkdir(profile, { recursive: true });
    const workConfig = { type: 'http', url: 'https://work' };
    await writeFile(join(profile, '.claude.json'), JSON.stringify({ mcpServers: { pencil: workConfig } }));
    vi.stubEnv('CLAUDE_CONFIG_DIR', profile);

    const e = await disableUnusedMcp(issue('pencil', 'user', ''));
    expect(e.backupPath.startsWith(join(profile, 'skills.disabled', '.mcp-backup') + '/')).toBe(true);
    expect(JSON.parse(await readFile(e.backupPath, 'utf-8')).config).toEqual(workConfig);
  });

  it('keeps the backup when removal errors but the server is already gone', async () => {
    removeMock.mockImplementationOnce(async () => {
      await writeFile(join(tmp.home, '.claude.json'), JSON.stringify({ mcpServers: {} }));
      throw new Error('`claude mcp remove` timed out');
    });
    await expect(disableUnusedMcp(issue('pencil', 'user', ''))).rejects.toThrow(/kept at/);
    expect(await backups()).toHaveLength(1);
  });
});
