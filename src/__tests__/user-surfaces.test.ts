import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { scanUserSurfaces } from '../scanner/user-surfaces.js';
import { initTokenizer } from '../tokenizer.js';
import { COMMAND_OVERHEAD_TOKENS, SKILL_PROMPT_OVERHEAD_TOKENS } from '../scanner/constants.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
  await initTokenizer();
});

afterEach(async () => {
  await tmp.cleanup();
});

async function writeAgent(name: string, content: string): Promise<string> {
  const dir = join(tmp.claudeDir, 'agents');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}.md`);
  await writeFile(path, content);
  return path;
}

async function writeUserCommand(name: string, content: string): Promise<string> {
  const dir = join(tmp.claudeDir, 'commands');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}.md`);
  await writeFile(path, content);
  return path;
}

describe('scanUserSurfaces', () => {
  it('returns empty results when neither directory exists', async () => {
    const result = await scanUserSurfaces();
    expect(result.agents).toEqual([]);
    expect(result.commands).toEqual([]);
  });

  it('measures an agent listing from its frontmatter description', async () => {
    await writeAgent(
      'reviewer',
      [
        '---',
        'name: reviewer',
        // Real agent descriptions run long — this is the case the flat 30-token
        // estimate used to under-report.
        'description: Reviews code changes for correctness, security, and style,' +
          ' producing severity-rated findings with concrete reproduction steps.' +
          ' Covers SOLID violations, unsafe input handling, race conditions,' +
          ' error-swallowing catch blocks, and performance regressions in hot' +
          ' paths. Use after any multi-file change lands on a feature branch.',
        '---',
        '',
        '# Long body',
        'x'.repeat(4000),
      ].join('\n'),
    );

    const { agents } = await scanUserSurfaces();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('reviewer');
    // Listing cost reflects the description, not the 4000-char body.
    expect(agents[0].listingTokens).toBeGreaterThan(SKILL_PROMPT_OVERHEAD_TOKENS);
    expect(agents[0].listingTokens).toBeLessThan(200);
    // Body tokens are tracked separately and must dwarf the listing cost.
    expect(agents[0].tokens).toBeGreaterThan(agents[0].listingTokens * 5);
  });

  it('falls back to the flat estimate for a command with no frontmatter', async () => {
    await writeUserCommand('git-log', 'git log --oneline -20');
    const { commands } = await scanUserSurfaces();
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe('git-log');
    expect(commands[0].listingTokens).toBe(COMMAND_OVERHEAD_TOKENS);
  });

  it('measures a command that does declare a description', async () => {
    await writeUserCommand(
      'doc-api',
      [
        '---',
        'description: Generates OpenAPI-shaped reference documentation from route' +
          ' handlers, including request and response schemas.',
        '---',
        'body',
      ].join('\n'),
    );
    const { commands } = await scanUserSurfaces();
    expect(commands[0].listingTokens).toBeGreaterThan(COMMAND_OVERHEAD_TOKENS);
  });

  it('ignores non-markdown files', async () => {
    const dir = join(tmp.claudeDir, 'agents');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'README.txt'), 'not an agent');
    await writeFile(join(dir, 'config.json'), '{}');
    await writeAgent('real', '---\ndescription: A real one.\n---');

    const { agents } = await scanUserSurfaces();
    expect(agents.map((a) => a.name)).toEqual(['real']);
  });

  it('skips broken symlinks — a dangling agent costs no prompt tokens', async () => {
    const dir = join(tmp.claudeDir, 'agents');
    await mkdir(dir, { recursive: true });
    await symlink('/nonexistent/vendor/agent.md', join(dir, 'dangling.md'));
    await writeAgent('healthy', '---\ndescription: Present and readable.\n---');

    const { agents } = await scanUserSurfaces();
    expect(agents.map((a) => a.name)).toEqual(['healthy']);
  });

  it('follows a valid symlink into a vendored pack', async () => {
    const vendorDir = join(tmp.claudeDir, 'vendor');
    await mkdir(vendorDir, { recursive: true });
    const realAgent = join(vendorDir, 'packaged.md');
    await writeFile(realAgent, '---\ndescription: Vendored agent body.\n---\ncontent');

    const agentsDir = join(tmp.claudeDir, 'agents');
    await mkdir(agentsDir, { recursive: true });
    await symlink(realAgent, join(agentsDir, 'linked.md'));

    const { agents } = await scanUserSurfaces();
    expect(agents.map((a) => a.name)).toEqual(['linked']);
    expect(agents[0].listingTokens).toBeGreaterThan(0);
  });

  it('scans agents and commands independently', async () => {
    await writeAgent('a1', '---\ndescription: Agent one.\n---');
    await writeAgent('a2', '---\ndescription: Agent two.\n---');
    await writeUserCommand('c1', '---\ndescription: Command one.\n---');

    const { agents, commands } = await scanUserSurfaces();
    expect(agents.map((a) => a.name).sort()).toEqual(['a1', 'a2']);
    expect(commands.map((c) => c.name)).toEqual(['c1']);
  });

  it('records sizeBytes for each entry', async () => {
    const body = '---\ndescription: Sized.\n---\nbody text';
    await writeAgent('sized', body);
    const { agents } = await scanUserSurfaces();
    expect(agents[0].sizeBytes).toBe(Buffer.byteLength(body));
  });
});
