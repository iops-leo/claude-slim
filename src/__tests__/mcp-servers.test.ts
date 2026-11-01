import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { scanMcpServers, mcpToolPrefix } from '../scanner/mcp.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';

/**
 * Claude Code reads MCP servers from `~/.claude.json` (user scope: top-level
 * `mcpServers`; local scope: `projects[<abs path>].mcpServers`) and from
 * `.mcp.json` files (project scope), not from `~/.claude/settings.json`.
 * https://code.claude.com/docs/en/mcp.md — "MCP installation scopes".
 *
 * Pre-2.15.2 the scanner read only `settings.json`, so on a real machine it
 * listed one server Claude Code never loaded and missed every real one.
 */
describe('scanMcpServers', () => {
  let tmp: TmpClaude;
  let project: string;
  let managedDir: string;

  beforeEach(async () => {
    tmp = await createTmpClaude();
    project = join(tmp.home, 'code', 'app');
    managedDir = join(tmp.home, 'managed');
    await mkdir(project, { recursive: true });
    await mkdir(managedDir, { recursive: true });
  });
  afterEach(async () => {
    await tmp.cleanup();
  });

  async function writeClaudeJson(data: unknown): Promise<void> {
    await writeFile(join(tmp.home, '.claude.json'), JSON.stringify(data));
  }

  it('reads user-scope servers from the top level of ~/.claude.json', async () => {
    await writeClaudeJson({ mcpServers: { pencil: { command: 'x' }, magic: { command: 'y' } } });
    const r = await scanMcpServers(project, { managedDir });
    expect(r.servers.map((s) => [s.name, s.scope, s.status])).toEqual([
      ['magic', 'user', 'active'],
      ['pencil', 'user', 'active'],
    ]);
    expect(r.count).toBe(2);
    expect(r.names).toEqual(['magic', 'pencil']);
  });

  it('reads local-scope servers only for the exact project path', async () => {
    await writeClaudeJson({
      projects: {
        [project]: { mcpServers: { here: {} } },
        [join(tmp.home, 'code')]: { mcpServers: { parentOnly: {} } },
      },
    });
    const r = await scanMcpServers(project, { managedDir });
    expect(r.servers.map((s) => [s.name, s.scope])).toEqual([['here', 'local']]);
  });

  it('marks servers turned off with /mcp (disabledMcpServers) as disabled, not active', async () => {
    await writeClaudeJson({
      mcpServers: { magic: {}, pencil: {} },
      projects: { [project]: { disabledMcpServers: ['magic'] } },
    });
    const r = await scanMcpServers(project, { managedDir });
    expect(r.servers.find((s) => s.name === 'magic')?.status).toBe('disabled');
    expect(r.count).toBe(1);
    expect(r.names).toEqual(['pencil']);
  });

  it('reads project-scope .mcp.json from the project and its ancestors, nearest first', async () => {
    await writeFile(join(tmp.home, '.mcp.json'), JSON.stringify({ mcpServers: { context7: {}, shared: { from: 'home' } } }));
    await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { shared: { from: 'project' } } }));
    await writeClaudeJson({ projects: { [project]: { enableAllProjectMcpServers: true } } });
    const r = await scanMcpServers(project, { managedDir });
    const shared = r.servers.filter((s) => s.name === 'shared');
    expect(shared).toHaveLength(1);
    expect(shared[0].path).toBe(join(project, '.mcp.json'));
    expect(r.servers.map((s) => [s.name, s.scope, s.status])).toEqual([
      ['context7', 'project', 'active'],
      ['shared', 'project', 'active'],
    ]);
  });

  it('treats unapproved .mcp.json servers as pending, and disabledMcpjsonServers as disabled', async () => {
    await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { a: {}, b: {}, c: {} } }));
    await writeClaudeJson({ projects: { [project]: { enabledMcpjsonServers: ['a'] } } });
    await mkdir(join(project, '.claude'), { recursive: true });
    await writeFile(join(project, '.claude', 'settings.local.json'), JSON.stringify({ disabledMcpjsonServers: ['b'] }));
    const r = await scanMcpServers(project, { managedDir });
    expect(r.servers.map((s) => [s.name, s.status])).toEqual([
      ['a', 'active'],
      ['b', 'disabled'],
      ['c', 'pending'],
    ]);
    expect(r.count).toBe(1);
  });

  it('resolves a name defined in several scopes as local > project > user', async () => {
    await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { dup: {}, dup2: {} } }));
    await writeClaudeJson({
      mcpServers: { dup: {}, dup2: {} },
      projects: { [project]: { mcpServers: { dup: {} }, enableAllProjectMcpServers: true } },
    });
    const r = await scanMcpServers(project, { managedDir });
    expect(r.servers.map((s) => [s.name, s.scope])).toEqual([
      ['dup', 'local'],
      ['dup2', 'project'],
    ]);
  });

  it('reports settings.json mcpServers as not loaded instead of counting them', async () => {
    await writeFile(join(tmp.claudeDir, 'settings.json'), JSON.stringify({ mcpServers: { qmd: {} } }));
    const r = await scanMcpServers(project, { managedDir });
    expect(r.count).toBe(0);
    expect(r.servers).toEqual([]);
    expect(r.notLoaded).toEqual(['qmd']);
  });

  it('ignores entries that are not server objects', async () => {
    await writeClaudeJson({ mcpServers: { bad: null, alsoBad: 'x', good: { command: 'g' } } });
    const r = await scanMcpServers(project, { managedDir });
    expect(r.servers.map((s) => s.name)).toEqual(['good']);
  });

  it('looks up local servers and toggles under the git root, also from a subdirectory', async () => {
    await mkdir(join(project, '.git'), { recursive: true });
    await mkdir(join(project, 'src', 'deep'), { recursive: true });
    await writeClaudeJson({
      mcpServers: { off: {} },
      projects: { [project]: { mcpServers: { here: {} }, disabledMcpServers: ['off'] } },
    });
    const r = await scanMcpServers(join(project, 'src', 'deep'), { managedDir });
    expect(r.servers.map((s) => [s.name, s.scope, s.status])).toEqual([
      ['here', 'local', 'active'],
      ['off', 'user', 'disabled'],
    ]);
  });

  it('resolves a git worktree to its main repository root', async () => {
    const wt = join(project, '.worktrees', 'feature');
    await mkdir(join(project, '.git', 'worktrees', 'feature'), { recursive: true });
    await mkdir(wt, { recursive: true });
    await writeFile(join(wt, '.git'), `gitdir: ${join(project, '.git', 'worktrees', 'feature')}\n`);
    await writeFile(join(project, '.git', 'worktrees', 'feature', 'commondir'), '../..\n');
    await writeClaudeJson({ projects: { [project]: { mcpServers: { here: {} } } } });
    const r = await scanMcpServers(wt, { managedDir });
    expect(r.servers.map((s) => s.name)).toEqual(['here']);
  });

  it('lets a higher-precedence false override enableAllProjectMcpServers', async () => {
    await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { p: {} } }));
    await writeFile(join(tmp.claudeDir, 'settings.json'), JSON.stringify({ enableAllProjectMcpServers: true }));
    await mkdir(join(project, '.claude'), { recursive: true });
    await writeFile(join(project, '.claude', 'settings.local.json'), JSON.stringify({ enableAllProjectMcpServers: false }));
    const r = await scanMcpServers(project, { managedDir });
    expect(r.servers[0].status).toBe('pending');
  });

  it('ignores approvals committed to .claude/settings.json in an untrusted folder', async () => {
    await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { p: {} } }));
    await mkdir(join(project, '.claude'), { recursive: true });
    await writeFile(join(project, '.claude', 'settings.json'), JSON.stringify({ enableAllProjectMcpServers: true }));
    const untrusted = await scanMcpServers(project, { managedDir });
    expect(untrusted.servers[0].status).toBe('pending');
    await writeClaudeJson({ projects: { [project]: { hasTrustDialogAccepted: true } } });
    const trusted = await scanMcpServers(project, { managedDir });
    expect(trusted.servers[0].status).toBe('active');
  });

  it('applies the /mcp toggle to project servers too', async () => {
    await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { p: {} } }));
    await writeClaudeJson({ projects: { [project]: { enableAllProjectMcpServers: true, disabledMcpServers: ['p'] } } });
    const r = await scanMcpServers(project, { managedDir });
    expect(r.servers[0].status).toBe('disabled');
  });

  it('gives managed-mcp.json exclusive control: everything else is blocked', async () => {
    await writeFile(join(managedDir, 'managed-mcp.json'), JSON.stringify({ mcpServers: { corp: { type: 'http', url: 'https://x' } } }));
    await writeClaudeJson({ mcpServers: { mine: {} } });
    const r = await scanMcpServers(project, { managedDir });
    expect(r.servers.map((s) => [s.name, s.scope, s.status])).toEqual([
      ['corp', 'managed', 'active'],
      ['mine', 'user', 'blocked'],
    ]);
    expect(r.count).toBe(1);
  });

  it('reads managedMcpServers from managed-settings.json, ahead of user servers with the same name', async () => {
    await writeFile(join(managedDir, 'managed-settings.json'), JSON.stringify({ managedMcpServers: { search: { type: 'http', url: 'https://s' } } }));
    await writeClaudeJson({ mcpServers: { search: {}, mine: {} } });
    const r = await scanMcpServers(project, { managedDir });
    expect(r.servers.map((s) => [s.name, s.scope, s.status])).toEqual([
      ['mine', 'user', 'active'],
      ['search', 'managed', 'active'],
    ]);
  });

  it('blocks servers named in deniedMcpServers from any settings file', async () => {
    await writeFile(join(tmp.claudeDir, 'settings.json'), JSON.stringify({ deniedMcpServers: [{ serverName: 'mine' }] }));
    await writeClaudeJson({ mcpServers: { mine: {}, other: {} } });
    const r = await scanMcpServers(project, { managedDir });
    expect(r.servers.find((s) => s.name === 'mine')?.status).toBe('blocked');
    expect(r.policyNotEvaluated).toBe(false);
  });

  it('flags URL/command policy entries it does not evaluate', async () => {
    await writeFile(join(managedDir, 'managed-settings.json'), JSON.stringify({ allowedMcpServers: [{ serverUrl: 'https://*.x/*' }] }));
    await writeClaudeJson({ mcpServers: { mine: {} } });
    const r = await scanMcpServers(project, { managedDir });
    expect(r.policyNotEvaluated).toBe(true);
  });

  it('survives missing and malformed files', async () => {
    await writeFile(join(tmp.home, '.claude.json'), '{not json');
    await writeFile(join(project, '.mcp.json'), '[]');
    const r = await scanMcpServers(project, { managedDir });
    expect(r).toMatchObject({ count: 0, names: [], servers: [], notLoaded: [], policyNotEvaluated: false });
  });
});

describe('mcpToolPrefix', () => {
  it.each([
    ['pencil', 'pencil'],
    ['claude.ai Gmail', 'claude_ai_Gmail'],
    ['google calendar', 'google_calendar'],
    ['my-server_2', 'my-server_2'],
  ])('%s → mcp__%s__', (name, prefix) => {
    expect(mcpToolPrefix(name)).toBe(prefix);
  });
});
