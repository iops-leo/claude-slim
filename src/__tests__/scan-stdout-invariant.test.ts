import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { scan } from '../scanner.js';
import { initTokenizer, flushCache } from '../tokenizer.js';
import { createTmpClaude, writeSkill, writeStaleProject, type TmpClaude } from './helpers/tmp-claude.js';

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
});

afterEach(async () => {
  await tmp.cleanup();
});

/**
 * Invariant: nothing in the scan pipeline (scanner, tokenizer, session parser,
 * plugin surface walker) may write to stdout. `claude-slim scan --json`
 * pipes stdout to `jq` / other tools, so any stray console.log — even a
 * warning — silently corrupts the machine-readable output.
 *
 * If this test fails, route the offending log through `console.error`
 * (stderr) instead. The CLI-level presenter in `src/cli.ts` is the only
 * layer permitted to write to stdout.
 */
describe('scan pipeline — stdout must stay silent (protects --json output)', () => {
  it('does not call console.log during initTokenizer + scan + flushCache (minimal fixture)', async () => {
    // Seed a realistic fixture so scanners have something to walk.
    await writeSkill(tmp.skillsDir, 'foo', '# Foo\n\nsample skill');
    await writeSkill(tmp.skillsDir, 'org/bar', '# Bar\n\nnested skill');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      await initTokenizer();
      await scan({ lookbackDays: 60 });
      await flushCache();
    } finally {
      logSpy.mockRestore();
      infoSpy.mockRestore();
    }

    // If either fires, some scanner module leaked to stdout. Route it to
    // console.error (stderr) so --json output stays parseable.
    expect(logSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('stays silent with a rich fixture (session logs, plugin cache, memory, CLAUDE.md)', async () => {
    // Exercise the code paths that only fire when specific artifacts exist —
    // the minimal-fixture test above can't reach these branches.

    // 1. CLAUDE.md at the root — read by parseClaudeMdSections / scan()
    await writeFile(
      join(tmp.claudeDir, 'CLAUDE.md'),
      '# Global\n\n## userEmail\ntest@example.com\n\n## project X\nnotes\n',
    );

    // 2. Session JSONL log — feeds scanSessionUsage (invokedSkills,
    //    mcpPrefixesInvoked, commandsInvoked). Include a tool_use, an MCP
    //    tool call, and a slash command (string-content shape).
    const projectDir = join(tmp.projectsDir, '-Users-someone-project');
    await mkdir(projectDir, { recursive: true });
    const sessionLines = [
      JSON.stringify({
        message: {
          content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'foo' } }],
        },
      }),
      JSON.stringify({
        message: {
          content: [{ type: 'tool_use', name: 'mcp__plugin_omc_mcp__query', input: {} }],
        },
      }),
      JSON.stringify({ message: { content: '/oh-my-claudecode:ralph run' } }),
    ].join('\n');
    await writeFile(join(projectDir, 'session-abc.jsonl'), sessionLines + '\n');

    // 3. Plugin cache with skills + MCP config + commands — exercises
    //    scanPluginSurfaces and scanPluginSkills branches.
    const pluginRoot = join(tmp.pluginsDir, 'omc', 'oh-my-claudecode', '1.0.0');
    await mkdir(join(pluginRoot, 'skills', 'ralph'), { recursive: true });
    await writeFile(join(pluginRoot, 'skills', 'ralph', 'SKILL.md'), '# Ralph');
    await mkdir(join(pluginRoot, 'commands'), { recursive: true });
    await writeFile(join(pluginRoot, 'commands', 'ralph.md'), 'run ralph');
    await writeFile(
      join(pluginRoot, '.mcp.json'),
      JSON.stringify({ mcpServers: { omc: {} } }),
    );

    // 4. Local skills at multiple depths
    await writeSkill(tmp.skillsDir, 'foo', '# Foo');
    await writeSkill(tmp.skillsDir, 'ns/bar', '# Bar');
    await writeSkill(tmp.skillsDir, 'ns/sub/deep', '# Deep');

    // 5. Stale project memory — feeds scanMemoryFiles
    await writeStaleProject(tmp.projectsDir, '-Users-someone-oldproj', {
      'MEMORY.md': '- old note\n',
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await initTokenizer();
      const result = await scan({ lookbackDays: 60 });
      await flushCache();

      // Sanity: the fixture actually exercised the enriched code paths.
      // (If any assertion here fails, the fixture drifted from scanner API.)
      expect(result.localSkills.length).toBeGreaterThanOrEqual(3);
    } finally {
      logSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    }

    expect(logSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
