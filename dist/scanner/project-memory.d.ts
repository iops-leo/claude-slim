import { type SettingsSources } from './settings-sources.js';
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
export declare function resolveProjectMemory(src: SettingsSources): Promise<ProjectMemoryLocation>;
