import { join } from 'node:path';
import { homedir } from 'node:os';
import { countTokensCached } from '../tokenizer.js';
import { listingTokens, listingTokensFromContent, parseFrontmatterDescription } from '../scanner/skill-listing.js';
import { safeReadFile, safeReaddir, isDirectory, isBrokenSymlink } from '../scanner/fs-walk.js';
import { detectBackupArtifact } from '../scanner/backup-artifacts.js';
import { sanitizeUntrustedTree } from '../scanner/untrusted.js';

// Codex support.
//
// The Claude Code scanner is deliberately left untouched: it is the
// battle-tested path, and a shared abstraction would have meant refactoring
// every scanner to prove a point. This module reuses the primitives that
// genuinely transfer — the tokenizer and the frontmatter parser — and adds only
// what differs.
//
// What transfers unchanged:
//   ~/.codex/skills/<name>/SKILL.md   identical YAML frontmatter to Claude Code
//   ~/.codex/plugins/cache/…/skills/  same nested layout
//   ~/.codex/AGENTS.md                the CLAUDE.md equivalent
//
// What differs:
//   agents are `<name>.toml` with `description = "…"`, not `<name>.md`
//   there is no user-level commands/ directory
//
// What is NOT available: unused-skill detection. Codex session logs
// (~/.codex/sessions/**.jsonl) record the skill *catalog* injected into each
// system prompt, not invocations — every skill appears in nearly every session,
// so using them as a usage signal would mark everything "used". Verified across
// 408 session files, a 56,724-row log database, and the thread_dynamic_tools
// table (a tool registry, not a history). See UNUSED_DETECTION_REASON.

export const UNUSED_DETECTION_REASON =
  'Codex session logs record the skill catalog, not invocations — there is no reliable usage signal to detect unused skills from.';

export interface CodexSkill {
  name: string;
  path: string;
  sizeBytes: number;
  /** Full SKILL.md body — what the skill costs once invoked. */
  tokens: number;
  /** The `- name: description` line it adds to the system prompt. */
  listingTokens: number;
  source: 'local' | 'plugin';
  pluginName?: string;
  /** Set when the name looks like a leftover copy; reported, never acted on. */
  backupArtifact?: string;
}

export interface CodexAgent {
  name: string;
  path: string;
  sizeBytes: number;
  tokens: number;
  listingTokens: number;
}

export interface CodexScanResult {
  root: string;
  skills: CodexSkill[];
  agents: CodexAgent[];
  instructionsBytes: number;
  instructionsTokens: number;
  /** Skill + agent listing lines + AGENTS.md — the fixed startup cost. */
  totalTokens: number;
  unusedDetectionAvailable: false;
  unusedDetectionReason: string;
}

export function getCodexDir(): string {
  return join(homedir(), '.codex');
}

export async function isCodexInstalled(): Promise<boolean> {
  return isDirectory(getCodexDir());
}

/**
 * Pull `description` out of a Codex agent TOML.
 *
 * All 18 agents observed use a single-line `description = "…"`; the multi-line
 * `"""` form is handled too so a future agent using it does not silently fall
 * back to the flat estimate.
 */
export function parseTomlDescription(content: string): string | null {
  const multi = /^description\s*=\s*"""\r?\n?([\s\S]*?)"""/m.exec(content);
  if (multi) {
    const joined = multi[1].split(/\r?\n/).map((l) => l.trim()).join(' ').trim();
    return joined || null;
  }

  // These files carry the agent's whole prompt inside `developer_instructions =
  // """…"""`, and that prose can contain a line that itself starts with
  // `description = "…"`. Matching line-anchored across the raw text picks up the
  // wrong one, so drop every triple-quoted block before looking for the
  // single-line form. (The multi-line `description` case is handled above, i.e.
  // before anything is stripped.)
  const withoutBlocks = content.replace(/"""[\s\S]*?"""/g, '');

  const single = /^description\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(withoutBlocks);
  if (!single) return null;
  const unescaped = single[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
  return unescaped || null;
}

async function scanLocalSkills(contents?: Map<string, string>): Promise<CodexSkill[]> {
  const dir = join(getCodexDir(), 'skills');
  const entries = await safeReaddir(dir);
  const results: CodexSkill[] = [];

  for (const entry of entries) {
    // `.system` and other dot-directories are Codex internals, not user skills.
    if (entry.startsWith('.')) continue;
    const skillDir = join(dir, entry);
    if (!(await isDirectory(skillDir))) continue;
    const md = join(skillDir, 'SKILL.md');
    if (await isBrokenSymlink(md)) continue;
    const content = await safeReadFile(md);
    if (content === null) continue;
    contents?.set(md, content);

    results.push({
      name: entry,
      path: skillDir,
      sizeBytes: Buffer.byteLength(content),
      tokens: countTokensCached(content, md),
      listingTokens: listingTokensFromContent(entry, content),
      source: 'local',
      backupArtifact: detectBackupArtifact(entry)?.label,
    });
  }
  return results;
}

/**
 * Walk `plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md`.
 * Bounded rather than fully recursive so a deep or looping tree cannot wedge the
 * scan — the layout is fixed and known.
 */
async function scanPluginSkills(): Promise<CodexSkill[]> {
  const cache = join(getCodexDir(), 'plugins', 'cache');
  const results: CodexSkill[] = [];

  for (const marketplace of await safeReaddir(cache)) {
    if (marketplace.startsWith('.')) continue;
    const mDir = join(cache, marketplace);
    if (!(await isDirectory(mDir))) continue;

    for (const plugin of await safeReaddir(mDir)) {
      if (plugin.startsWith('.')) continue;
      const pDir = join(mDir, plugin);
      if (!(await isDirectory(pDir))) continue;

      for (const version of await safeReaddir(pDir)) {
        const skillsDir = join(pDir, version, 'skills');
        if (!(await isDirectory(skillsDir))) continue;

        for (const skill of await safeReaddir(skillsDir)) {
          const sDir = join(skillsDir, skill);
          if (!(await isDirectory(sDir))) continue;
          const md = join(sDir, 'SKILL.md');
          if (await isBrokenSymlink(md)) continue;
          const content = await safeReadFile(md);
          if (content === null) continue;

          results.push({
            name: skill,
            path: sDir,
            sizeBytes: Buffer.byteLength(content),
            tokens: countTokensCached(content, md),
            listingTokens: listingTokensFromContent(skill, content),
            source: 'plugin',
            pluginName: plugin,
          });
        }
      }
    }
  }
  return results;
}

async function scanAgents(): Promise<CodexAgent[]> {
  const dir = join(getCodexDir(), 'agents');
  const results: CodexAgent[] = [];

  for (const entry of await safeReaddir(dir)) {
    if (!entry.endsWith('.toml')) continue;
    const path = join(dir, entry);
    if (await isBrokenSymlink(path)) continue;
    const content = await safeReadFile(path);
    if (content === null) continue;

    const name = entry.slice(0, -'.toml'.length);
    results.push({
      name,
      path,
      sizeBytes: Buffer.byteLength(content),
      tokens: countTokensCached(content, path),
      listingTokens: listingTokens(name, parseTomlDescription(content)),
    });
  }
  return results;
}

/**
 * @param contents optional sink for SKILL.md bodies, so detectors can inspect
 *   them without a second pass over the filesystem. Deliberately an out-param
 *   rather than part of the result: it must not land in `scan --json`.
 */
export async function scanCodex(contents?: Map<string, string>): Promise<CodexScanResult | null> {
  if (!(await isCodexInstalled())) return null;

  const [local, plugin, agents] = await Promise.all([
    scanLocalSkills(contents),
    scanPluginSkills(),
    scanAgents(),
  ]);

  const instructionsPath = join(getCodexDir(), 'AGENTS.md');
  const instructions = await safeReadFile(instructionsPath);
  const instructionsBytes = instructions ? Buffer.byteLength(instructions) : 0;
  const instructionsTokens = instructions
    ? countTokensCached(instructions, instructionsPath)
    : 0;

  const skills = [...local, ...plugin];
  const listing = (xs: Array<{ listingTokens: number }>): number =>
    xs.reduce((sum, x) => sum + x.listingTokens, 0);

  // ~/.codex labels are authored by whoever wrote those skills and agents, and
  // the CLI merges this tree into `scan --json` and prints skill names to the
  // terminal. It never passes through the ~/.claude scanner, so it sanitizes on
  // its own way out.
  return sanitizeUntrustedTree({
    root: getCodexDir(),
    skills,
    agents,
    instructionsBytes,
    instructionsTokens,
    totalTokens: listing(skills) + listing(agents) + instructionsTokens,
    unusedDetectionAvailable: false,
    unusedDetectionReason: UNUSED_DETECTION_REASON,
  });
}

/** Re-exported so callers can reuse the frontmatter parser without a deep import. */
export { parseFrontmatterDescription };
