import { join, relative } from 'node:path';
import { getClaudeDir } from '../paths.js';
import { countTokensCached } from '../tokenizer.js';
import { safeReadFile, safeReaddir, isDirectory, resolveRealPath } from './fs-walk.js';

// `~/.claude/rules/**/*.md` is loaded at launch with the same priority as
// CLAUDE.md — unless a file carries `paths:` frontmatter, in which case it is
// pulled in only when Claude reads a file matching one of those globs. Before
// v2.15 neither kind was measured, so the startup estimate silently omitted
// every rule on the machine.
// Source: https://code.claude.com/docs/en/memory.md

export interface RuleEntry {
  /** Path relative to the rules directory, e.g. `common/style.md`. */
  name: string;
  path: string;
  sizeBytes: number;
  tokens: number;
  /** True when `paths:` frontmatter scopes the rule to matching files. */
  conditional: boolean;
  /** The globs from `paths:`; empty for an unconditional rule. */
  paths: string[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Rules directories rarely nest past two levels; a symlink loop nests forever. */
const MAX_RULES_DEPTH = 8;

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Drop an unquoted trailing `# comment` from a YAML scalar. */
function stripComment(s: string): string {
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i);
    }
  }
  return s;
}

/**
 * Split a YAML flow sequence body on commas that are not inside quotes or
 * braces — `"src/**\/*.{ts,tsx}"` is one glob, not two.
 */
function splitFlowList(inner: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '{' || ch === '[') {
      depth++;
      current += ch;
    } else if (ch === '}' || ch === ']') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      items.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items.map(unquote).filter((s) => s.length > 0);
}

/**
 * The `paths:` list from a rule's frontmatter, or null when absent.
 *
 * Handles the YAML shapes seen in the wild — a block list at any indent, an
 * inline flow list, and a bare scalar — without pulling in a YAML parser for
 * one key. Comments and blank lines inside a block list are skipped; the list
 * ends at the next top-level key.
 */
export function parseFrontmatterPaths(content: string): string[] | null {
  const fm = FRONTMATTER.exec(content);
  if (!fm) return null;
  const lines = fm[1].split(/\r?\n/);
  const idx = lines.findIndex((l) => /^paths\s*:/.test(l));
  if (idx === -1) return null;

  const inline = stripComment(lines[idx].replace(/^paths\s*:/, '')).trim();
  if (inline.startsWith('[')) {
    return splitFlowList(inline.replace(/^\[/, '').replace(/\]\s*$/, ''));
  }
  if (inline.length > 0) return [unquote(inline)];

  const items: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(#|$)/.test(line)) continue; // comment or blank
    const m = /^\s*-\s*(.*)$/.exec(line);
    if (!m) break; // next key
    const value = stripComment(m[1]).trim();
    if (value) items.push(unquote(value));
  }
  return items;
}

export function getUserRulesDir(): string {
  return join(getClaudeDir(), 'rules');
}

/**
 * Collect `*.md` files below `dir`. Directories are deduplicated by real
 * path and capped in depth: a symlink pointing back at an ancestor would
 * otherwise re-emit the same file once per lap until ELOOP, and every copy
 * would be summed into the startup total.
 */
async function walkMarkdown(
  dir: string,
  out: string[],
  seenDirs: Set<string>,
  depth: number,
): Promise<void> {
  if (depth > MAX_RULES_DEPTH) return;
  const real = await resolveRealPath(dir);
  if (seenDirs.has(real)) return;
  seenDirs.add(real);

  const entries = await safeReaddir(dir);
  for (const entry of entries) {
    const p = join(dir, entry);
    if (await isDirectory(p)) {
      await walkMarkdown(p, out, seenDirs, depth + 1);
    } else if (entry.endsWith('.md')) {
      out.push(p);
    }
  }
}

export async function scanUserRules(): Promise<RuleEntry[]> {
  const root = getUserRulesDir();
  const files: string[] = [];
  await walkMarkdown(root, files, new Set(), 0);

  // Two names for one file (a symlinked rule beside its target) is one rule.
  const seenFiles = new Set<string>();
  const entries = await Promise.all(
    files.map(async (path): Promise<RuleEntry | null> => {
      const real = await resolveRealPath(path);
      if (seenFiles.has(real)) return null;
      seenFiles.add(real);
      const content = await safeReadFile(path);
      if (content === null) return null;
      const paths = parseFrontmatterPaths(content) ?? [];
      return {
        name: relative(root, path).split('\\').join('/'),
        path,
        sizeBytes: Buffer.byteLength(content),
        tokens: countTokensCached(content, path),
        conditional: paths.length > 0,
        paths,
      };
    }),
  );
  return entries.filter((e): e is RuleEntry => e !== null);
}
