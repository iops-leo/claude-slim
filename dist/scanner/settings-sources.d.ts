/**
 * The settings files and per-project state Claude Code consults for one
 * working directory. Shared by the MCP, synced-skill and memory scanners so
 * they agree on which project a directory belongs to and which files apply.
 * https://code.claude.com/docs/en/settings.md
 */
export type Json = Record<string, unknown>;
export declare function isObject(v: unknown): v is Json;
export declare function readJson(path: string): Promise<Json | null>;
export declare function stringList(container: Json | null | undefined, key: string): string[];
export declare function firstBoolean(sources: Array<Json | null | undefined>, key: string): boolean | undefined;
export declare function firstString(sources: Array<Json | null | undefined>, key: string): string | undefined;
export declare function getManagedDir(platform?: NodeJS.Platform): string;
export declare function getClaudeJsonPath(): string;
/**
 * The repository root Claude Code files per-project state under: the nearest
 * ancestor holding `.git`, and for a linked worktree the main checkout it
 * belongs to. Null outside a repository.
 *
 * Auto memory, local MCP servers and the project-local settings file are all
 * keyed by this root, so every subdirectory and worktree shares them
 * (https://code.claude.com/docs/en/memory.md, "Storage location").
 */
export declare function findRepoRoot(dir: string): Promise<string | null>;
export interface SettingsSources {
    /** The resolved working directory. */
    dir: string;
    repoRoot: string | null;
    /** `repoRoot ?? dir` — the project Claude Code files this directory under. */
    root: string;
    claudeJson: Json | null;
    userSettings: Json | null;
    /** `.claude/settings.json` in the working directory. */
    projectSettings: Json | null;
    /** `.claude/settings.local.json` files, highest precedence first. */
    localSettingsList: Array<Json | null>;
    managedSettings: Json | null;
    /** `~/.claude.json` → `projects[<key>]`, when present. */
    projectKey: string | undefined;
    projectState: Json | null;
    /** The workspace trust dialog was accepted for this project. */
    trusted: boolean;
    /**
     * Trust as applied to hooks-class settings (and `autoMemoryDirectory`): the
     * folder or a parent folder was trusted. A parent above the repository root
     * does not count — inside a nested repository Claude Code asks again.
     * https://code.claude.com/docs/en/permissions.md#what-runs-before-you-trust-a-folder
     */
    trustedForHooks: boolean;
}
export declare function readSettingsSources(projectDir: string, managedDir?: string): Promise<SettingsSources>;
