import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extractSkillsFromTranscript,
  extractMcpPrefixesFromTranscript,
  extractCommandsFromTranscript,
  scanSessionUsage,
} from '../scanner/sessions.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';

// ---------------------------------------------------------------------------
// extractMcpPrefixesFromTranscript
// ---------------------------------------------------------------------------

describe('extractMcpPrefixesFromTranscript', () => {
  it('returns empty set for empty input', () => {
    expect(extractMcpPrefixesFromTranscript('')).toEqual(new Set());
  });

  it('extracts mcp prefix from a single mcp tool_use event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'mcp__plugin_oh-my-claudecode_t__lsp_diagnostics',
            input: {},
          },
        ],
      },
    });
    expect(extractMcpPrefixesFromTranscript(line)).toEqual(
      new Set(['plugin_oh-my-claudecode_t']),
    );
  });

  it('extracts multiple distinct prefixes across lines', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'mcp__filesystem__read_file', input: {} },
            { type: 'tool_use', name: 'mcp__filesystem__list_directory', input: {} },
          ],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'mcp__playwright__browser_click', input: {} },
          ],
        },
      }),
    ];
    expect(extractMcpPrefixesFromTranscript(lines.join('\n'))).toEqual(
      new Set(['filesystem', 'playwright']),
    );
  });

  it('extracts 3 distinct prefixes from fixture with 3 different mcp tools', () => {
    const lines = [
      JSON.stringify({
        message: { content: [{ type: 'tool_use', name: 'mcp__alpha__do_thing', input: {} }] },
      }),
      JSON.stringify({
        message: { content: [{ type: 'tool_use', name: 'mcp__beta__do_thing', input: {} }] },
      }),
      JSON.stringify({
        message: { content: [{ type: 'tool_use', name: 'mcp__gamma__do_thing', input: {} }] },
      }),
    ];
    const result = extractMcpPrefixesFromTranscript(lines.join('\n'));
    expect(result).toEqual(new Set(['alpha', 'beta', 'gamma']));
  });

  it('ignores non-mcp tool_use events and malformed lines', () => {
    const lines = [
      'bad json',
      JSON.stringify({
        message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'init' } }] },
      }),
      JSON.stringify({
        message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
      }),
    ];
    expect(extractMcpPrefixesFromTranscript(lines.join('\n'))).toEqual(new Set());
  });

  it('skips mcp__ names that do not have a second __ separator', () => {
    const line = JSON.stringify({
      message: {
        content: [{ type: 'tool_use', name: 'mcp__nodouble', input: {} }],
      },
    });
    expect(extractMcpPrefixesFromTranscript(line)).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// extractCommandsFromTranscript
// ---------------------------------------------------------------------------

describe('extractCommandsFromTranscript', () => {
  it('returns empty set for empty input', () => {
    expect(extractCommandsFromTranscript('')).toEqual(new Set());
  });

  it('extracts command name from <command-name> tag in user message', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<command-name>/grill-me</command-name>\n<command-message>grill-me</command-message>',
          },
        ],
      },
    });
    expect(extractCommandsFromTranscript(line)).toEqual(new Set(['grill-me']));
  });

  it('strips leading slash from command name', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '<command-name>/clear</command-name>' }],
      },
    });
    const result = extractCommandsFromTranscript(line);
    expect(result.has('clear')).toBe(true);
    expect(result.has('/clear')).toBe(false);
  });

  it('extracts multiple commands from multiple user messages', () => {
    const lines = [
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '<command-name>/plan</command-name>' }],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '<command-name>/commit</command-name>' }],
        },
      }),
    ];
    expect(extractCommandsFromTranscript(lines.join('\n'))).toEqual(
      new Set(['plan', 'commit']),
    );
  });

  it('ignores <command-name> in assistant messages', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Use <command-name>/foo</command-name> to do bar',
          },
        ],
      },
    });
    // assistant messages should not produce commands
    expect(extractCommandsFromTranscript(line)).toEqual(new Set());
  });

  it('handles malformed lines silently', () => {
    expect(extractCommandsFromTranscript('not json\n{}\n')).toEqual(new Set());
  });

  // Regression: real Claude Code transcripts may store user content as a plain
  // string (not an array of blocks). Earlier impl skipped these silently,
  // missing every slash command in the live log.
  it('extracts command from user message with string content', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content:
          '<command-name>/exit</command-name>\n            <command-message>exit</command-message>',
      },
    });
    expect(extractCommandsFromTranscript(line)).toEqual(new Set(['exit']));
  });

  it('extracts commands from mixed string and array content lines', () => {
    const lines = [
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: '<command-name>/clear</command-name>',
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '<command-name>/plan</command-name>' }],
        },
      }),
    ];
    expect(extractCommandsFromTranscript(lines.join('\n'))).toEqual(
      new Set(['clear', 'plan']),
    );
  });
});

// ---------------------------------------------------------------------------
// scanSessionUsage — new fields
// ---------------------------------------------------------------------------

describe('scanSessionUsage extended fields', () => {
  let tmp: TmpClaude;

  beforeEach(async () => {
    tmp = await createTmpClaude();
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  async function writeRawSession(
    project: string,
    sessionId: string,
    lines: string[],
  ): Promise<string> {
    const projectDir = join(tmp.projectsDir, project);
    await mkdir(projectDir, { recursive: true });
    const filePath = join(projectDir, `${sessionId}.jsonl`);
    await writeFile(filePath, lines.join('\n') + '\n');
    return filePath;
  }

  function mcpLine(name: string) {
    return JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name, input: {} }] },
    });
  }

  function commandLine(cmd: string) {
    return JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: `<command-name>${cmd}</command-name>` }],
      },
    });
  }

  function skillLine(skill: string) {
    return JSON.stringify({
      message: {
        content: [{ type: 'tool_use', name: 'Skill', input: { skill } }],
      },
    });
  }

  // Test 1: mcp tool invocations produce correct prefix set
  it('extracts mcp prefixes from session files', async () => {
    await writeRawSession('proj-a', 's1', [
      mcpLine('mcp__alpha__do_a'),
      mcpLine('mcp__beta__do_b'),
      skillLine('init'),
    ]);
    await writeRawSession('proj-a', 's2', [mcpLine('mcp__alpha__do_c'), skillLine('commit')]);
    await writeRawSession('proj-a', 's3', [skillLine('plan')]);

    const result = await scanSessionUsage(60);
    expect(result.mcpPrefixesInvoked).toEqual(new Set(['alpha', 'beta']));
  });

  // Test 2: <command-name> produces commandsInvoked entries
  it('extracts commands from <command-name> tags', async () => {
    await writeRawSession('proj-a', 's1', [
      commandLine('/foo'),
      skillLine('init'),
    ]);
    await writeRawSession('proj-a', 's2', [commandLine('/bar'), skillLine('commit')]);
    await writeRawSession('proj-a', 's3', [skillLine('plan')]);

    const result = await scanSessionUsage(60);
    expect(result.commandsInvoked).toEqual(new Set(['foo', 'bar']));
  });

  // Test 3: totalUserCallableInvocations === 0 when nothing invoked
  it('returns totalUserCallableInvocations=0 when no skills/mcp/commands used', async () => {
    await writeRawSession('proj-a', 's1', [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } }),
    ]);
    await writeRawSession('proj-a', 's2', [
      JSON.stringify({ type: 'assistant', message: { content: [] } }),
    ]);
    await writeRawSession('proj-a', 's3', [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [] } }),
    ]);

    const result = await scanSessionUsage(60);
    expect(result.totalUserCallableInvocations).toBe(0);
  });

  // Test 4: totalUserCallableInvocations sums skills + mcp + commands
  it('totalUserCallableInvocations counts skill + mcp + command invocations', async () => {
    await writeRawSession('proj-a', 's1', [
      skillLine('init'),          // 1 skill
      skillLine('commit'),         // 1 skill
      mcpLine('mcp__alpha__do_a'), // 1 mcp
      commandLine('/plan'),        // 1 command
    ]);
    await writeRawSession('proj-a', 's2', [skillLine('init')]);
    await writeRawSession('proj-a', 's3', [skillLine('init')]);

    const result = await scanSessionUsage(60);
    // 2 (from s1) + 1 (mcp) + 1 (command) + 1 (s2) + 1 (s3) = 6 total
    expect(result.totalUserCallableInvocations).toBe(6);
  });

  // Test 5: cache hit with new fields → no reparse
  it('honors cache when mtime matches and new fields are present', async () => {
    const filePath = await writeRawSession('proj-a', 's1', [
      mcpLine('mcp__alpha__do_a'),
      skillLine('init'),
    ]);
    await writeRawSession('proj-a', 's2', [skillLine('commit')]);
    await writeRawSession('proj-a', 's3', [skillLine('plan')]);

    const { mtimeMs } = await stat(filePath);
    const cachePath = join(tmp.claudeDir, '.skill-usage-cache.json');
    await writeFile(
      cachePath,
      JSON.stringify({
        version: 1,
        entries: {
          [filePath]: {
            mtimeMs,
            skills: ['from-cache'],
            mcpPrefixes: ['cached-prefix'],
            commands: ['cached-cmd'],
            invocationCount: 3,
          },
        },
      }),
    );

    const result = await scanSessionUsage(60);
    // Should use cache — sees 'from-cache', not 'init'
    expect(result.invokedSkills.has('from-cache')).toBe(true);
    expect(result.invokedSkills.has('init')).toBe(false);
    expect(result.mcpPrefixesInvoked.has('cached-prefix')).toBe(true);
    expect(result.commandsInvoked.has('cached-cmd')).toBe(true);
  });

  // Test 6: cache hit missing new fields → invalidate, reparse
  it('invalidates cache when new mcp/commands fields are absent', async () => {
    const filePath = await writeRawSession('proj-a', 's1', [
      mcpLine('mcp__alpha__do_a'),
      skillLine('init'),
    ]);
    await writeRawSession('proj-a', 's2', [skillLine('commit')]);
    await writeRawSession('proj-a', 's3', [skillLine('plan')]);

    const { mtimeMs } = await stat(filePath);
    const cachePath = join(tmp.claudeDir, '.skill-usage-cache.json');
    // Old-schema cache: has skills but no mcpPrefixes/commands fields
    await writeFile(
      cachePath,
      JSON.stringify({
        version: 1,
        entries: {
          [filePath]: { mtimeMs, skills: ['stale-cache'] },
        },
      }),
    );

    const result = await scanSessionUsage(60);
    // Stale cache should be invalidated; file reparsed
    expect(result.invokedSkills.has('init')).toBe(true);
    expect(result.invokedSkills.has('stale-cache')).toBe(false);
    expect(result.mcpPrefixesInvoked.has('alpha')).toBe(true);
  });

  // Test 7: backward compat — existing unused_skill callers unaffected
  it('still populates invokedSkills for unused_skill detector', async () => {
    await writeRawSession('proj-a', 's1', [skillLine('init'), skillLine('commit')]);
    await writeRawSession('proj-a', 's2', [skillLine('commit')]);
    await writeRawSession('proj-a', 's3', [skillLine('plan')]);

    const result = await scanSessionUsage(60);
    expect(result.invokedSkills).toEqual(new Set(['init', 'commit', 'plan']));
    expect(result.dataAvailable).toBe(true);
  });
});
