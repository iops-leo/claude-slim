// What Claude Code actually sent at the start of a recent session.
//
// Since 2.1.x the session log records the session-start context as
// `attachment` events: the rendered skill listing, the agent catalog, MCP
// server instructions, the deferred tool-name list and the instruction files.
// Reading those back measures the real startup context instead of rebuilding
// it from disk — including the parts disk analysis cannot see: skills whose
// descriptions were dropped to fit the listing budget, claude.ai connectors,
// and MCP tool names.
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { countTokens } from '../tokenizer.js';

export interface ListingEntry {
  name: string;
  chars: number;
  /** Rendered as a bare name: the model sees no description for it. */
  collapsed: boolean;
}

export interface DeferredToolsSummary {
  count: number;
  chars: number;
  tokens: number;
  servers: Array<{ server: string; tools: number; chars: number }>;
  /** Tool names exposed by more than one MCP server. */
  collisions: Array<{ tool: string; servers: string[] }>;
  /**
   * Server pairs sharing most of their tool names — almost always one
   * connector added twice (e.g. once by hand, once as a claude.ai connector).
   * `chars` is what the smaller copy's shared names cost in the listing.
   */
  duplicateServers: Array<{ servers: [string, string]; shared: number; chars: number }>;
  needsAuth: string[];
}

export interface MeasuredStartup {
  sessionFile: string;
  fromOtherProject: boolean;
  entrypoint?: string;
  version?: string;
  model?: string;
  timestamp?: string;
  /** input + cache creation + cache read on the first assistant turn. */
  firstTurnInputTokens?: number;
  skillListing?: { chars: number; tokens: number; skillCount: number; entries: ListingEntry[] };
  agentListing?: { chars: number; tokens: number; count: number };
  mcpInstructions?: { chars: number; tokens: number; servers: Array<{ name: string; chars: number }> };
  deferredTools?: DeferredToolsSummary;
  instructions?: { files: Array<{ path: string; type: string; chars: number; tokens: number }> };
}

const BUILT_IN = '(built-in)';
const MCP_TOOL = /^mcp__(.+?)__(.+)$/;
const ALIAS_ONLY = /^ \([^)\n]*\)$/;
/** Headless SDK sessions run with their own prompts; prefer anything else. */
const isHeadless = (entrypoint: string | undefined): boolean =>
  entrypoint !== undefined && entrypoint.startsWith('sdk');
const MAX_CANDIDATES = 40;

/**
 * Split a rendered skill listing into entries using the attachment's `names`
 * array, which is in render order. Descriptions may span lines, so splitting
 * on newlines would mis-assign them.
 */
export function parseSkillListing(content: string, names: readonly string[]): ListingEntry[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const name of names) {
    const marker = `- ${name}`;
    // Reject a longer name that merely starts with this one (`review-pr` vs `review`).
    const endsAt = (pos: number): boolean => {
      const after = content[pos + marker.length];
      return after === undefined || after === '\n' || after === ':' || after === ' ';
    };
    let at = cursor === 0 && content.startsWith(marker) && endsAt(0) ? 0 : -1;
    let from = cursor;
    while (at === -1) {
      const hit = content.indexOf(`\n${marker}`, from);
      if (hit === -1) break;
      if (endsAt(hit + 1)) at = hit + 1;
      else from = hit + 1;
    }
    starts.push(at);
    if (at !== -1) cursor = at + marker.length;
  }
  return names.map((name, i) => {
    const start = starts[i];
    if (start === -1) return { name, chars: 0, collapsed: false };
    const next = starts.slice(i + 1).find((s) => s !== -1);
    const end = next === undefined ? content.length : next - 1;
    const rest = content.slice(start + 2 + name.length, end);
    return { name, chars: end - start, collapsed: rest === '' || ALIAS_ONLY.test(rest) };
  });
}

// Claude Code gives every MCP server that still needs sign-in the same two
// placeholder tools. Sharing them is not a collision anyone can act on.
const AUTH_PLACEHOLDER_TOOLS = new Set(['authenticate', 'complete_authentication']);
const DUPLICATE_MIN_SHARED = 3;
const DUPLICATE_MIN_RATIO = 0.8;

function findDuplicateServers(
  byTool: Map<string, Set<string>>,
): DeferredToolsSummary['duplicateServers'] {
  const toolsOf = new Map<string, Set<string>>();
  for (const [tool, servers] of byTool) {
    for (const s of servers) toolsOf.set(s, new Set([...(toolsOf.get(s) ?? []), tool]));
  }
  const names = [...toolsOf.keys()].sort();
  const out: DeferredToolsSummary['duplicateServers'] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = toolsOf.get(names[i])!;
      const b = toolsOf.get(names[j])!;
      const shared = [...a].filter((t) => b.has(t));
      if (shared.length < DUPLICATE_MIN_SHARED) continue;
      if (shared.length < DUPLICATE_MIN_RATIO * Math.min(a.size, b.size)) continue;
      const smaller = a.size <= b.size ? names[i] : names[j];
      const chars = shared.reduce((sum, t) => sum + `mcp__${smaller}__${t}`.length + 1, 0);
      out.push({ servers: [names[i], names[j]], shared: shared.length, chars });
    }
  }
  return out.sort((x, y) => y.chars - x.chars);
}

export function analyzeDeferredTools(
  lines: readonly string[],
  needsAuth: readonly string[] = [],
): DeferredToolsSummary {
  const byServer = new Map<string, { tools: number; chars: number }>();
  const byTool = new Map<string, Set<string>>();
  for (const l of lines) {
    const m = MCP_TOOL.exec(l);
    const server = m ? m[1] : BUILT_IN;
    const cur = byServer.get(server) ?? { tools: 0, chars: 0 };
    byServer.set(server, { tools: cur.tools + 1, chars: cur.chars + l.length + 1 });
    if (m && !AUTH_PLACEHOLDER_TOOLS.has(m[2])) {
      byTool.set(m[2], new Set([...(byTool.get(m[2]) ?? []), m[1]]));
    }
  }
  const text = lines.join('\n');
  return {
    duplicateServers: findDuplicateServers(byTool),
    count: lines.length,
    chars: text.length,
    tokens: countTokens(text),
    servers: [...byServer.entries()]
      .map(([server, v]) => ({ server, ...v }))
      .sort((a, b) => b.chars - a.chars),
    collisions: [...byTool.entries()]
      .filter(([, s]) => s.size > 1)
      .map(([tool, s]) => ({ tool, servers: [...s].sort() }))
      .sort((a, b) => a.tool.localeCompare(b.tool)),
    needsAuth: [...needsAuth],
  };
}

type Json = Record<string, unknown>;
const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function applyAttachment(m: MeasuredStartup, a: Json): void {
  switch (a.type) {
    case 'skill_listing': {
      if (m.skillListing || a.isInitial === false || typeof a.content !== 'string') return;
      const names = asStrings(a.names);
      m.skillListing = {
        chars: a.content.length,
        tokens: countTokens(a.content),
        skillCount: names.length,
        entries: parseSkillListing(a.content, names),
      };
      return;
    }
    case 'agent_listing_delta': {
      if (m.agentListing) return;
      const lines = asStrings(a.addedLines);
      const text = lines.join('\n');
      m.agentListing = { chars: text.length, tokens: countTokens(text), count: lines.length };
      return;
    }
    case 'mcp_instructions_delta': {
      if (m.mcpInstructions) return;
      const names = asStrings(a.addedNames);
      const blocks = asStrings(a.addedBlocks);
      const text = blocks.join('\n\n');
      m.mcpInstructions = {
        chars: text.length,
        tokens: countTokens(text),
        servers: blocks.map((b, i) => ({ name: names[i] ?? `server ${i + 1}`, chars: b.length })),
      };
      return;
    }
    case 'deferred_tools_delta': {
      if (m.deferredTools) return;
      const lines = asStrings(a.addedLines);
      m.deferredTools = analyzeDeferredTools(
        lines.length > 0 ? lines : asStrings(a.addedNames),
        asStrings(a.needsAuthMcpServers),
      );
      return;
    }
    case 'instructions': {
      if (m.instructions || !Array.isArray(a.files)) return;
      const files = (a.files as unknown[])
        .filter((f): f is Json => typeof f === 'object' && f !== null)
        .map((f) => {
          const content = typeof f.content === 'string' ? f.content : '';
          return {
            path: typeof f.path === 'string' ? f.path : '',
            type: typeof f.type === 'string' ? f.type : '',
            chars: content.length,
            tokens: countTokens(content),
          };
        });
      m.instructions = { files };
      return;
    }
  }
}

function sumUsage(u: unknown): number | undefined {
  if (typeof u !== 'object' || u === null) return undefined;
  const r = u as Json;
  const n = (k: string): number => (typeof r[k] === 'number' ? (r[k] as number) : 0);
  return n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens');
}

/**
 * Read the session-start attachments of one log. Stops at the first main-chain
 * assistant turn: later attachments describe changes during the session, not
 * what every turn starts with. Returns null when the log has no skill listing
 * (older Claude Code, or a session that never started).
 */
export async function readStartupAttachments(
  file: string,
  fromOtherProject = false,
): Promise<MeasuredStartup | null> {
  const m: MeasuredStartup = { sessionFile: file, fromOtherProject };
  const rl = createInterface({ input: createReadStream(file, 'utf-8'), crlfDelay: Infinity });
  try {
    for await (const raw of rl) {
      if (!raw) continue;
      let o: Json;
      try {
        o = JSON.parse(raw) as Json;
      } catch {
        continue;
      }
      if (typeof o.entrypoint === 'string') m.entrypoint ??= o.entrypoint;
      if (typeof o.version === 'string') m.version ??= o.version;
      if (typeof o.timestamp === 'string') m.timestamp ??= o.timestamp;
      if (o.type === 'attachment' && typeof o.attachment === 'object' && o.attachment !== null) {
        applyAttachment(m, o.attachment as Json);
      } else if (o.type === 'assistant' && o.isSidechain !== true) {
        const msg = (o.message ?? {}) as Json;
        if (typeof msg.model === 'string') m.model = msg.model;
        m.firstTurnInputTokens = sumUsage(msg.usage);
        break;
      }
    }
  } finally {
    rl.close();
  }
  return m.skillListing ? m : null;
}

async function newestLogs(dir: string): Promise<Array<{ file: string; mtimeMs: number }>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: Array<{ file: string; mtimeMs: number }> = [];
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const file = join(dir, n);
    try {
      out.push({ file, mtimeMs: (await stat(file)).mtimeMs });
    } catch {
      /* vanished between readdir and stat */
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_CANDIDATES);
}

async function pick(
  logs: Array<{ file: string }>,
  fromOtherProject: boolean,
): Promise<MeasuredStartup | null> {
  let headless: MeasuredStartup | null = null;
  for (const { file } of logs) {
    const m = await readStartupAttachments(file, fromOtherProject);
    if (!m) continue;
    if (!isHeadless(m.entrypoint)) return m;
    headless ??= m;
  }
  return headless;
}

/**
 * The newest session in `slug` that recorded its startup context, preferring
 * interactive sessions. Falls back to the newest such session in any project
 * (flagged `fromOtherProject`, since memory and project CLAUDE.md differ).
 */
export async function findMeasuredSession(
  projectsDir: string,
  slug: string,
): Promise<MeasuredStartup | null> {
  const own = await pick(await newestLogs(join(projectsDir, slug)), false);
  if (own) return own;
  let dirs: string[];
  try {
    dirs = await readdir(projectsDir);
  } catch {
    return null;
  }
  const all: Array<{ file: string; mtimeMs: number }> = [];
  for (const d of dirs) {
    if (d === slug) continue;
    all.push(...(await newestLogs(join(projectsDir, d))));
  }
  all.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return pick(all.slice(0, MAX_CANDIDATES), true);
}
