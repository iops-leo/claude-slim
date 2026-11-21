import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseSkillListing,
  readStartupAttachments,
  findMeasuredSession,
  analyzeDeferredTools,
} from '../scanner/measured-startup.js';
import { initTokenizer } from '../tokenizer.js';

beforeAll(async () => {
  await initTokenizer();
});

const line = (o: unknown): string => JSON.stringify(o);

function sessionLines(opts: {
  entrypoint?: string;
  listing?: { content: string; names: string[] };
  extra?: unknown[];
} = {}): string {
  const ep = opts.entrypoint ?? 'cli';
  const listing = opts.listing ?? {
    content: '- alpha: Does alpha things.\n- beta\n- gamma (g): Gamma\nspans two lines.',
    names: ['alpha', 'beta', 'gamma'],
  };
  return [
    line({ type: 'user', entrypoint: ep, version: '2.1.323', timestamp: '2026-11-20T10:00:00.000Z', message: { role: 'user', content: 'hi' } }),
    line({ type: 'attachment', attachment: { type: 'skill_listing', content: listing.content, skillCount: listing.names.length, isInitial: true, names: listing.names, digests: [] } }),
    line({ type: 'attachment', attachment: { type: 'agent_listing_delta', addedTypes: ['a1'], addedLines: ['- a1: Agent one'], isInitial: true } }),
    line({ type: 'attachment', attachment: { type: 'mcp_instructions_delta', addedNames: ['srv'], addedBlocks: ['## srv\nUse srv tools carefully.'], removedNames: [] } }),
    line({ type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: ['Monitor', 'mcp__a__search_files', 'mcp__b__search_files', 'mcp__b__other'], addedLines: ['Monitor', 'mcp__a__search_files', 'mcp__b__search_files', 'mcp__b__other'], needsAuthMcpServers: ['claude.ai Asana'] } }),
    line({ type: 'attachment', attachment: { type: 'instructions', files: [{ path: '/home/u/.claude/CLAUDE.md', type: 'User', content: '# Rules\nBe brief.' }] } }),
    ...(opts.extra ?? []).map(line),
    line({ type: 'assistant', entrypoint: ep, message: { model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 50 } } }),
    // Anything after the first assistant turn is not session-start context.
    line({ type: 'attachment', attachment: { type: 'skill_listing', content: '- late: Added later', skillCount: 1, isInitial: false, names: ['late'], digests: [] } }),
  ].join('\n');
}

describe('parseSkillListing', () => {
  it('marks entries rendered without a description as collapsed', () => {
    const entries = parseSkillListing(
      '- alpha: Does alpha things.\n- beta\n- gamma (g): Gamma\nspans two lines.\n- plug:skill',
      ['alpha', 'beta', 'gamma', 'plug:skill'],
    );
    expect(entries.map((e) => [e.name, e.collapsed])).toEqual([
      ['alpha', false],
      ['beta', true],
      ['gamma', false],
      ['plug:skill', true],
    ]);
  });

  it('keeps a multi-line description inside its own entry', () => {
    const entries = parseSkillListing('- a: one\ntwo\n- b: three', ['a', 'b']);
    expect(entries[0].chars).toBe('- a: one\ntwo'.length);
  });

  it('treats a name-only entry with an alias as collapsed', () => {
    const entries = parseSkillListing('- p:plan (p:omc-plan)\n- q: Q', ['p:plan', 'q']);
    expect(entries[0].collapsed).toBe(true);
    expect(entries[1].collapsed).toBe(false);
  });

  it('does not confuse a name that prefixes another', () => {
    const entries = parseSkillListing('- review: R\n- review-pr', ['review', 'review-pr']);
    expect(entries.map((e) => e.collapsed)).toEqual([false, true]);
  });
});

describe('analyzeDeferredTools', () => {
  it('groups names by MCP server and finds tool names exposed by two servers', () => {
    const r = analyzeDeferredTools(['Monitor', 'mcp__a__search_files', 'mcp__b__search_files', 'mcp__b__other']);
    expect(r.count).toBe(4);
    expect(r.servers.find((s) => s.server === 'b')?.tools).toBe(2);
    expect(r.servers.find((s) => s.server === '(built-in)')?.tools).toBe(1);
    expect(r.collisions).toEqual([{ tool: 'search_files', servers: ['a', 'b'] }]);
    expect(r.duplicateServers).toEqual([]);
  });

  it('reports two servers sharing most of their tools as one connector connected twice', () => {
    const tools = ['create', 'list', 'get', 'delete'];
    const r = analyzeDeferredTools([
      ...tools.map((t) => `mcp__claude_ai_2__${t}`),
      ...tools.map((t) => `mcp__claude_ai_ElevenLabs__${t}`),
      'mcp__claude_ai_ElevenLabs__extra',
    ]);
    expect(r.duplicateServers).toEqual([
      { servers: ['claude_ai_2', 'claude_ai_ElevenLabs'], shared: 4, chars: 'mcp__claude_ai_2__create\nmcp__claude_ai_2__list\nmcp__claude_ai_2__get\nmcp__claude_ai_2__delete\n'.length },
    ]);
  });
});

describe('readStartupAttachments', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'measured-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads what Claude Code sent before the first assistant turn', async () => {
    const f = join(dir, 's.jsonl');
    await writeFile(f, sessionLines());
    const m = await readStartupAttachments(f);
    expect(m).not.toBeNull();
    expect(m!.entrypoint).toBe('cli');
    expect(m!.version).toBe('2.1.323');
    expect(m!.model).toBe('claude-opus-5-5');
    expect(m!.skillListing!.skillCount).toBe(3);
    expect(m!.skillListing!.entries.filter((e) => e.collapsed).map((e) => e.name)).toEqual(['beta']);
    expect(m!.skillListing!.entries.some((e) => e.name === 'late')).toBe(false);
    expect(m!.agentListing!.count).toBe(1);
    expect(m!.mcpInstructions!.servers).toEqual([{ name: 'srv', chars: '## srv\nUse srv tools carefully.'.length }]);
    expect(m!.deferredTools!.collisions).toHaveLength(1);
    expect(m!.deferredTools!.needsAuth).toEqual(['claude.ai Asana']);
    expect(m!.instructions!.files[0].path).toBe('/home/u/.claude/CLAUDE.md');
    expect(m!.firstTurnInputTokens).toBe(152);
  });

  it('returns null for a log without a skill listing', async () => {
    const f = join(dir, 's.jsonl');
    await writeFile(f, line({ type: 'user', message: { content: 'x' } }));
    expect(await readStartupAttachments(f)).toBeNull();
  });

  it('skips unparseable lines', async () => {
    const f = join(dir, 's.jsonl');
    await writeFile(f, '{not json\n' + sessionLines());
    expect((await readStartupAttachments(f))?.skillListing?.skillCount).toBe(3);
  });
});

describe('findMeasuredSession', () => {
  let projects: string;
  beforeEach(async () => {
    projects = await mkdtemp(join(tmpdir(), 'projects-'));
  });
  afterEach(async () => {
    await rm(projects, { recursive: true, force: true });
  });

  async function put(slug: string, name: string, body: string, ageSec: number): Promise<void> {
    await mkdir(join(projects, slug), { recursive: true });
    const f = join(projects, slug, name);
    await writeFile(f, body);
    const t = Date.now() / 1000 - ageSec;
    await utimes(f, t, t);
  }

  it('prefers the newest interactive session in the current project over headless ones', async () => {
    await put('proj', 'old-cli.jsonl', sessionLines({ entrypoint: 'cli' }), 300);
    await put('proj', 'new-sdk.jsonl', sessionLines({ entrypoint: 'sdk-cli' }), 10);
    const m = await findMeasuredSession(projects, 'proj');
    expect(m?.sessionFile.endsWith('old-cli.jsonl')).toBe(true);
  });

  it('falls back to a headless session when there is no interactive one', async () => {
    await put('proj', 'only-sdk.jsonl', sessionLines({ entrypoint: 'sdk-cli' }), 10);
    const m = await findMeasuredSession(projects, 'proj');
    expect(m?.entrypoint).toBe('sdk-cli');
  });

  it('falls back to the newest session in any project', async () => {
    await put('other', 'x.jsonl', sessionLines(), 10);
    const m = await findMeasuredSession(projects, 'missing-project');
    expect(m?.sessionFile.endsWith('x.jsonl')).toBe(true);
    expect(m?.fromOtherProject).toBe(true);
  });

  it('returns null when nothing has a skill listing', async () => {
    await put('proj', 'a.jsonl', line({ type: 'user', message: { content: 'x' } }), 10);
    expect(await findMeasuredSession(projects, 'proj')).toBeNull();
  });
});
