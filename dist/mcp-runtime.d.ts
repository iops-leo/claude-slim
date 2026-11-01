export type RemovableMcpScope = 'user' | 'local';
/**
 * `claude mcp remove -s <scope> -- <name>`. Removal goes through Claude Code's
 * own writer rather than editing `~/.claude.json` here: running sessions
 * rewrite that file, and a hand edit races them.
 *
 * `local` scope is keyed by project, so `cwd` must be that project.
 */
export declare function removeMcpServer(name: string, scope: RemovableMcpScope, cwd: string): Promise<void>;
/**
 * `claude mcp add-json -s <scope> -- <name> <json>`. The definition travels
 * as one argv element — there is no stdin form — so it is briefly visible to
 * other local users through the process list while the command runs.
 */
export declare function addMcpServerJson(name: string, scope: RemovableMcpScope, config: unknown, cwd: string): Promise<void>;
