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
  let sessionsScanned = 0;
  let sessionsInWindow = 0;

  let projectDirs: string[] = [];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return { invokedSkills, dataAvailable: false, sessionsScanned: 0, sessionsInWindow: 0 };
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

      // Cache hit: reuse the parsed skill list, no I/O on the file body.
      const cached = cache.entries[filePath];
      if (cached && cached.mtimeMs === mtimeMs) {
        for (const s of cached.skills) invokedSkills.add(s);
        newEntries[filePath] = cached;
        continue;
      }

      let content: string;
      try { content = await readFile(filePath, 'utf-8'); } catch { continue; }
      const skills = extractSkillsFromTranscript(content);
      for (const s of skills) invokedSkills.add(s);
      newEntries[filePath] = { mtimeMs, skills: Array.from(new Set(skills)) };
    }
  }

  const dataAvailable =
    sessionsInWindow >= MIN_SESSIONS_FOR_DATA_AVAILABLE && invokedSkills.size > 0;

  await saveCache({ version: CACHE_VERSION, entries: newEntries });

  return { invokedSkills, dataAvailable, sessionsScanned, sessionsInWindow };
}
