import { readFile, readdir, stat, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { getClaudeDir } from '../paths.js';

const CACHE_VERSION = 1;
// Below this many sessions in the lookback window we suppress unused-skill
// classification — too little signal, "unused" would be misleading.
const MIN_SESSIONS_FOR_DATA_AVAILABLE = 3;

interface SessionCacheEntry {
  mtimeMs: number;
  skills: string[];
  // v2.6 extension fields; absent in old cache entries → triggers re-parse
  mcpPrefixes?: string[];
  commands?: string[];
  invocationCount?: number;
}

interface SessionUsageCacheFile {
  version: number;
  entries: Record<string, SessionCacheEntry>;
}

export interface SessionScanResult {
  invokedSkills: Set<string>;
  // false → caller MUST suppress unused-skill classification. Either we have
  // too few sessions to draw a conclusion, or we found sessions but zero
  // Skill invocations (most likely a Claude Code session-log schema change).
  dataAvailable: boolean;
  sessionsScanned: number;
  sessionsInWindow: number;
  // v2.6 extension: mcp and command signals for unused-plugin detector
  mcpPrefixesInvoked: Set<string>;
  commandsInvoked: Set<string>;
  // Total of skill + mcp + command invocations (raw event count, not unique);
  // used by suppression logic — 0 means no user-callable tool was ever invoked.
  totalUserCallableInvocations: number;
}

// Parsed result for a single JSONL file
interface FileParseResult {
  skills: string[];
  mcpPrefixes: string[];
  commands: string[];
  invocationCount: number;
}

function getCachePath(): string {
  return join(getClaudeDir(), '.skill-usage-cache.json');
}

async function loadCache(): Promise<SessionUsageCacheFile> {
  try {
    const raw = await readFile(getCachePath(), 'utf-8');
    const parsed = JSON.parse(raw) as SessionUsageCacheFile;
    if (parsed.version !== CACHE_VERSION) return { version: CACHE_VERSION, entries: {} };
    return parsed;
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
}

async function saveCache(cache: SessionUsageCacheFile): Promise<void> {
  const target = getCachePath();
  const tmp = target + '.tmp';
  try {
    await mkdir(dirname(target), { recursive: true });
    // Atomic write — same pattern as token cache. A crash mid-flush leaves the
    // prior cache intact rather than a torn JSON file.
    await writeFile(tmp, JSON.stringify(cache));
    await rename(tmp, target);
  } catch {
    // Non-critical: missing cache just means a slower next scan.
  }
}

// Extract Skill-tool invocations from a single JSONL session log.
// Each line in `~/.claude/projects/<slug>/<sessionId>.jsonl` is a JSON event;
// we look for `message.content[]` entries shaped
//   { type: 'tool_use', name: 'Skill', input: { skill: '<id>' } }
// and collect the `skill` strings (e.g. 'superpowers:brainstorming').
//
// Schema-defensive: any line/field that does not match is silently skipped,
// so a partial schema change degrades gracefully rather than throwing.
export function extractSkillsFromTranscript(content: string): string[] {
  const skills: string[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line) continue;
    let obj: unknown;
    try { obj = JSON.parse(line); } catch { continue; }
    if (typeof obj !== 'object' || obj === null) continue;
    const message = (obj as Record<string, unknown>).message;
    if (typeof message !== 'object' || message === null) continue;
    const msgContent = (message as Record<string, unknown>).content;
    if (!Array.isArray(msgContent)) continue;
    for (const c of msgContent) {
      if (typeof c !== 'object' || c === null) continue;
      const rec = c as Record<string, unknown>;
      if (rec.type !== 'tool_use' || rec.name !== 'Skill') continue;
      const input = rec.input;
      if (typeof input !== 'object' || input === null) continue;
      const skill = (input as Record<string, unknown>).skill;
      if (typeof skill === 'string') skills.push(skill);
    }
  }
  return skills;
}

// Extract MCP server prefixes from tool_use events whose name matches
// `mcp__<prefix>__<tool>`. Returns the set of unique prefixes seen.
//
// Example: `mcp__plugin_oh-my-claudecode_t__lsp_diagnostics` → `plugin_oh-my-claudecode_t`
export function extractMcpPrefixesFromTranscript(content: string): Set<string> {
  const prefixes = new Set<string>();
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line) continue;
    let obj: unknown;
    try { obj = JSON.parse(line); } catch { continue; }
    if (typeof obj !== 'object' || obj === null) continue;
    const message = (obj as Record<string, unknown>).message;
    if (typeof message !== 'object' || message === null) continue;
    const msgContent = (message as Record<string, unknown>).content;
    if (!Array.isArray(msgContent)) continue;
    for (const c of msgContent) {
      if (typeof c !== 'object' || c === null) continue;
      const rec = c as Record<string, unknown>;
      if (rec.type !== 'tool_use') continue;
      const name = rec.name;
      if (typeof name !== 'string' || !name.startsWith('mcp__')) continue;
      // Must have at least two __ separators: mcp__<prefix>__<tool>
      const after = name.slice('mcp__'.length);
      const sep = after.indexOf('__');
      if (sep === -1) continue;
      prefixes.add(after.slice(0, sep));
    }
  }
  return prefixes;
}

// Extract slash command names from user messages containing the
// `<command-name>/foo</command-name>` tag that Claude Code injects when a
// user runs a slash command. The leading slash is stripped so callers receive
// plain names like "clear" or "grill-me".
//
// Only `type === "user"` / `role === "user"` messages are examined to avoid
// false positives from assistant text that may reference command names.
export function extractCommandsFromTranscript(content: string): Set<string> {
  const commands = new Set<string>();
  const TAG_RE = /<command-name>([^<]+)<\/command-name>/g;
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line) continue;
    let obj: unknown;
    try { obj = JSON.parse(line); } catch { continue; }
    if (typeof obj !== 'object' || obj === null) continue;
    const rec = obj as Record<string, unknown>;
    // Only inspect user-role messages
    const message = rec.message;
    if (typeof message !== 'object' || message === null) continue;
    const msgRec = message as Record<string, unknown>;
    if (msgRec.role !== 'user') continue;
    const msgContent = msgRec.content;
    // User content may be a plain string or an array of content blocks.
    const texts: string[] = [];
    if (typeof msgContent === 'string') {
      texts.push(msgContent);
    } else if (Array.isArray(msgContent)) {
      for (const c of msgContent) {
        if (typeof c !== 'object' || c === null) continue;
        const text = (c as Record<string, unknown>).text;
        if (typeof text === 'string') texts.push(text);
      }
    }
    for (const text of texts) {
      TAG_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = TAG_RE.exec(text)) !== null) {
        // Strip leading slash from the command value (e.g. "/clear" → "clear")
        const raw = match[1].trim();
        commands.add(raw.startsWith('/') ? raw.slice(1) : raw);
      }
    }
  }
  return commands;
}

// Parse all signals from a single JSONL transcript.
function parseTranscript(content: string): FileParseResult {
  const skills = extractSkillsFromTranscript(content);
  const mcpPrefixes = Array.from(extractMcpPrefixesFromTranscript(content));
  const commands = Array.from(extractCommandsFromTranscript(content));
  const invocationCount = skills.length + mcpPrefixes.length + commands.length;
  return { skills, mcpPrefixes, commands, invocationCount };
}

// Walk every `~/.claude/projects/<slug>/*.jsonl` whose mtime falls inside the
// lookback window. Per-file results are cached by mtime, so warm scans only
// re-read files that have changed.
export async function scanSessionUsage(lookbackDays: number): Promise<SessionScanResult> {
  const projectsDir = join(getClaudeDir(), 'projects');
  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const cache = await loadCache();
  // Pruned cache: only entries seen this scan survive. Keeps the file bounded
  // across many scans even as old session logs get rotated/deleted.
  const newEntries: Record<string, SessionCacheEntry> = {};
  const invokedSkills = new Set<string>();
  const mcpPrefixesInvoked = new Set<string>();
  const commandsInvoked = new Set<string>();
  let totalUserCallableInvocations = 0;
  let sessionsScanned = 0;
  let sessionsInWindow = 0;

  let projectDirs: string[] = [];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return {
      invokedSkills,
      dataAvailable: false,
      sessionsScanned: 0,
      sessionsInWindow: 0,
      mcpPrefixesInvoked,
      commandsInvoked,
      totalUserCallableInvocations: 0,
    };
  }

  for (const projectName of projectDirs) {
    const projectPath = join(projectsDir, projectName);
    let entries: string[] = [];
    try { entries = await readdir(projectPath); } catch { continue; }

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const filePath = join(projectPath, entry);

      let mtimeMs: number;
      try { mtimeMs = (await stat(filePath)).mtimeMs; } catch { continue; }

      sessionsScanned++;
      if (mtimeMs < cutoffMs) continue;
      sessionsInWindow++;

      // Cache hit: reuse the parsed result only if mtime matches AND the entry
      // has the v2.6 extension fields (mcpPrefixes / commands). Entries from
      // older cache files lack these fields → force a re-parse.
      const cached = cache.entries[filePath];
      if (
        cached &&
        cached.mtimeMs === mtimeMs &&
        Array.isArray(cached.mcpPrefixes) &&
        Array.isArray(cached.commands)
      ) {
        for (const s of cached.skills) invokedSkills.add(s);
        for (const p of cached.mcpPrefixes) mcpPrefixesInvoked.add(p);
        for (const cmd of cached.commands) commandsInvoked.add(cmd);
        totalUserCallableInvocations += cached.invocationCount ?? 0;
        newEntries[filePath] = cached;
        continue;
      }

      let content: string;
      try { content = await readFile(filePath, 'utf-8'); } catch { continue; }
      const parsed = parseTranscript(content);

      for (const s of parsed.skills) invokedSkills.add(s);
      for (const p of parsed.mcpPrefixes) mcpPrefixesInvoked.add(p);
      for (const cmd of parsed.commands) commandsInvoked.add(cmd);
      totalUserCallableInvocations += parsed.invocationCount;

      newEntries[filePath] = {
        mtimeMs,
        skills: Array.from(new Set(parsed.skills)),
        mcpPrefixes: Array.from(new Set(parsed.mcpPrefixes)),
        commands: Array.from(new Set(parsed.commands)),
        invocationCount: parsed.invocationCount,
      };
    }
  }

  const dataAvailable =
    sessionsInWindow >= MIN_SESSIONS_FOR_DATA_AVAILABLE && invokedSkills.size > 0;

  await saveCache({ version: CACHE_VERSION, entries: newEntries });

  return {
    invokedSkills,
    dataAvailable,
    sessionsScanned,
    sessionsInWindow,
    mcpPrefixesInvoked,
    commandsInvoked,
    totalUserCallableInvocations,
  };
}
