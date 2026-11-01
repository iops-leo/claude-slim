import { execFile } from 'node:child_process';
import { ClaudeCliMissingError, isClaudeMissing } from './plugin-runtime.js';
import { getConfigDirOverride } from './paths.js';

export type RemovableMcpScope = 'user' | 'local';

/**
 * Server names reach `claude` as an argv element after `--`, so they cannot be
 * parsed as flags and no shell is involved. Still refuse names that could not
 * have come from a real config: empty, or carrying control characters.
 */
function validateServerName(name: string): void {
  if (!name || /[\u0000-\u001F\u007F]/.test(name)) {
    throw new Error(`Refusing to operate on suspicious MCP server name: ${JSON.stringify(name)}`);
  }
}

function validateScope(scope: string): asserts scope is RemovableMcpScope {
  if (scope !== 'user' && scope !== 'local') {
    throw new Error(`Refusing to operate on MCP scope: ${scope}`);
  }
}

/**
 * Run `claude`. Errors carry stderr or a generic description, never
 * `err.message`: Node puts the full argv in it, and for `add-json` that argv
 * holds the server definition with whatever tokens its `env`/`headers` carry.
 */
function runClaude(args: string[], cwd: string, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Hand the child the profile this process resolved, as an absolute path:
    // it runs in a different cwd, where a relative CLAUDE_CONFIG_DIR would
    // name a different profile than the one we backed up from.
    const override = getConfigDirOverride();
    const env = override ? { ...process.env, CLAUDE_CONFIG_DIR: override } : process.env;
    execFile('claude', args, { cwd, env, timeout: 30000 }, (err, _stdout, stderr) => {
      if (err) {
        if (isClaudeMissing(err)) {
          reject(new ClaudeCliMissingError());
          return;
        }
        const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
        const why = e.killed ? 'timed out' : `exited with ${String(e.code ?? 'an error')}`;
        reject(new Error(stderr?.trim() || `${label} ${why}`));
        return;
      }
      resolve();
    });
  });
}

/**
 * `claude mcp remove -s <scope> -- <name>`. Removal goes through Claude Code's
 * own writer rather than editing `~/.claude.json` here: running sessions
 * rewrite that file, and a hand edit races them.
 *
 * `local` scope is keyed by project, so `cwd` must be that project.
 */
export async function removeMcpServer(name: string, scope: RemovableMcpScope, cwd: string): Promise<void> {
  validateServerName(name);
  validateScope(scope);
  await runClaude(['mcp', 'remove', '-s', scope, '--', name], cwd, '`claude mcp remove`');
}

/**
 * `claude mcp add-json -s <scope> -- <name> <json>`. The definition travels
 * as one argv element — there is no stdin form — so it is briefly visible to
 * other local users through the process list while the command runs.
 */
export async function addMcpServerJson(
  name: string,
  scope: RemovableMcpScope,
  config: unknown,
  cwd: string,
): Promise<void> {
  validateServerName(name);
  validateScope(scope);
  await runClaude(['mcp', 'add-json', '-s', scope, '--', name, JSON.stringify(config)], cwd, '`claude mcp add-json`');
}
