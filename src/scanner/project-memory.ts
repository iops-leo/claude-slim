import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { slugifyProjectPath } from '../paths.js';
import { type SettingsSources, type Json, isObject, firstBoolean, firstString } from './settings-sources.js';

/**
 * Where a session started in this directory keeps its auto memory
 * (https://code.claude.com/docs/en/memory.md, "Storage location"):
 *
 * - `~/.claude/projects/<slug>/memory/`, where the slug is derived from the
 *   git repository root, so subdirectories and worktrees share one directory.
 *   Pre-2.16.1 the slug came from the literal working directory, and a scan
 *   from a subdirectory or worktree reported 0 tokens of memory.
 * - `autoMemoryDirectory` instead, when settings name one.
 * - nowhere, when auto memory is off.
 */
export interface ProjectMemoryLocation {
  slug: string;
  /** No auto memory loads at startup (turned off, or its directory is blocked). */
  disabled: boolean;
  /** `autoMemoryDirectory`, resolved, when set by an honoured settings file. */
  customDir?: string;
}

function expandHome(p: string): string | undefined {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : undefined; // the docs require absolute or ~/
}

/**
 * `CLAUDE_CODE_DISABLE_AUTO_MEMORY` overrides `autoMemoryEnabled` in either
 * direction: `1` turns memory off, `0` forces it on even over a `false`
 * setting. Unset or unrecognised leaves the settings in charge.
 */
function envOverride(): boolean | undefined {
  const v = (process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return false;
  if (['0', 'false', 'no', 'off'].includes(v)) return true;
  return undefined;
}

function blocksOutsideReads(s: Json | null | undefined): boolean {
  const perms = s?.permissions;
  return isObject(perms) && perms.blockReadsOutsideWorkingDirectories === true;
}

export async function resolveProjectMemory(src: SettingsSources): Promise<ProjectMemoryLocation> {
  // Claude Code keys memory by the repo root and does not fall back to an
  // older per-cwd folder, so neither does this.
  const slug = slugifyProjectPath(src.root);

  const byPrecedence = [src.managedSettings, ...src.localSettingsList, src.projectSettings, src.userSettings];
  const enabled = envOverride() ?? firstBoolean(byPrecedence, 'autoMemoryEnabled') ?? true;
  if (!enabled) return { slug, disabled: true };

  // The directory a repository's own settings choose counts once the folder
  // (or a parent within the repo) is trusted, the same rule as hooks.
  const adminSources = [src.managedSettings, src.userSettings];
  const repoSources = src.trustedForHooks ? [...src.localSettingsList, src.projectSettings] : [];
  const fromAdmin = firstString([src.managedSettings], 'autoMemoryDirectory');
  const fromRepo = fromAdmin ? undefined : firstString(repoSources, 'autoMemoryDirectory');
  const raw = fromAdmin ?? fromRepo ?? firstString([src.userSettings], 'autoMemoryDirectory');

  // With blockReadsOutsideWorkingDirectories on (honoured as `true` from any
  // scope), a directory a repository's settings chose is neither read nor
  // written, wherever it is.
  if (fromRepo && [...adminSources, ...src.localSettingsList, src.projectSettings].some(blocksOutsideReads)) {
    return { slug, disabled: true };
  }
  const customDir = raw ? expandHome(raw) : undefined;
  return { slug, disabled: false, ...(customDir ? { customDir } : {}) };
}
