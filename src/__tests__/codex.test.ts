import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { dir } from 'tmp-promise';
import { Command } from 'commander';
import { vi } from 'vitest';
import {
  scanCodex,
  isCodexInstalled,
  parseTomlDescription,
  UNUSED_DETECTION_REASON,
} from '../codex/index.js';
import { formatCodexSummary } from '../codex/report.js';
import { initTokenizer } from '../tokenizer.js';

let home: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  await initTokenizer();
});

beforeEach(async () => {
  const d = await dir({ unsafeCleanup: true });
  home = d.path;
  cleanup = d.cleanup;
  vi.stubEnv('HOME', home);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanup();
});

const codexDir = (): string => join(home, '.codex');

async function writeSkill(name: string, description: string | null, body = 'content'): Promise<void> {
  const d = join(codexDir(), 'skills', name);
  await mkdir(d, { recursive: true });
  const fm = description === null ? '' : `---\nname: ${name}\ndescription: ${description}\n---\n`;
  await writeFile(join(d, 'SKILL.md'), fm + body);
}

async function writePluginSkill(
  marketplace: string, plugin: string, version: string, skill: string, description: string,
): Promise<void> {
  const d = join(codexDir(), 'plugins', 'cache', marketplace, plugin, version, 'skills', skill);
  await mkdir(d, { recursive: true });
  await writeFile(join(d, 'SKILL.md'), `---\ndescription: ${description}\n---\nbody`);
}

async function writeAgent(name: string, toml: string): Promise<void> {
  const d = join(codexDir(), 'agents');
  await mkdir(d, { recursive: true });
  await writeFile(join(d, `${name}.toml`), toml);
}

describe('parseTomlDescription', () => {
  it('reads a single-line description — the form all 18 observed agents use', () => {
    const toml = 'name = "analyst"\ndescription = "Requirements clarity, hidden constraints"\nmodel = "gpt-5.5"\n';
    expect(parseTomlDescription(toml)).toBe('Requirements clarity, hidden constraints');
  });

  it('reads a multi-line block description', () => {
    const toml = 'name = "x"\ndescription = """\nFirst line.\nSecond line.\n"""\n';
    expect(parseTomlDescription(toml)).toBe('First line. Second line.');
  });

  it('unescapes embedded quotes', () => {
    expect(parseTomlDescription('description = "He said \\"hi\\" once"')).toBe('He said "hi" once');
  });

  it('is not fooled by description appearing inside another value', () => {
    const toml = 'developer_instructions = """\ndescription = "not the real one"\n"""\n';
    expect(parseTomlDescription(toml)).toBeNull();
  });

  it('returns null when absent or empty', () => {
    expect(parseTomlDescription('name = "x"\nmodel = "y"')).toBeNull();
    expect(parseTomlDescription('description = ""')).toBeNull();
  });
});

describe('scanCodex', () => {
  it('returns null when ~/.codex does not exist', async () => {
    expect(await isCodexInstalled()).toBe(false);
    expect(await scanCodex()).toBeNull();
  });

  it('reads local skills using the same frontmatter parser as Claude Code', async () => {
    await writeSkill('autopilot', '"[OMX] Strict autonomous loop"');
    const r = await scanCodex();
    expect(r).not.toBeNull();
    expect(r!.skills).toHaveLength(1);
    expect(r!.skills[0].name).toBe('autopilot');
    expect(r!.skills[0].source).toBe('local');
    expect(r!.skills[0].listingTokens).toBeGreaterThan(0);
  });

  it('skips Codex-internal dot directories such as .system', async () => {
    await writeSkill('real', 'A real skill.');
    await mkdir(join(codexDir(), 'skills', '.system'), { recursive: true });
    await writeFile(join(codexDir(), 'skills', '.system', 'SKILL.md'), '---\ndescription: internal\n---');

    const r = await scanCodex();
    expect(r!.skills.map((s) => s.name)).toEqual(['real']);
  });

  it('walks the marketplace/plugin/version/skills plugin layout', async () => {
    await writePluginSkill('openai-bundled', 'computer-use', '1.0.1000550', 'computer-use', 'Drive the desktop.');
    await writePluginSkill('openai-curated', 'google-drive', '2.0.0', 'google-docs', 'Edit docs.');

    const r = await scanCodex();
    const plugins = r!.skills.filter((s) => s.source === 'plugin');
    expect(plugins).toHaveLength(2);
    expect(plugins.map((p) => p.pluginName).sort()).toEqual(['computer-use', 'google-drive']);
  });

  it('reads agents from TOML', async () => {
    await writeAgent('analyst', 'name = "analyst"\ndescription = "Requirements clarity"\n');
    await writeAgent('critic', 'name = "critic"\ndescription = "Reviews plans"\n');

    const r = await scanCodex();
    expect(r!.agents.map((a) => a.name).sort()).toEqual(['analyst', 'critic']);
    expect(r!.agents[0].listingTokens).toBeGreaterThan(0);
  });

  it('ignores non-TOML files in agents/', async () => {
    await writeAgent('real', 'description = "Real agent"');
    await writeFile(join(codexDir(), 'agents', 'README.md'), '# not an agent');

    const r = await scanCodex();
    expect(r!.agents.map((a) => a.name)).toEqual(['real']);
  });

  it('counts AGENTS.md as the instructions file', async () => {
    await mkdir(codexDir(), { recursive: true });
    await writeFile(join(codexDir(), 'AGENTS.md'), '# Instructions\n'.repeat(50));

    const r = await scanCodex();
    expect(r!.instructionsTokens).toBeGreaterThan(0);
    expect(r!.instructionsBytes).toBeGreaterThan(0);
  });

  it('totals only the startup cost — listings plus AGENTS.md, not skill bodies', async () => {
    await writeSkill('a', 'Short.', 'x'.repeat(5_000));
    await mkdir(codexDir(), { recursive: true });
    await writeFile(join(codexDir(), 'AGENTS.md'), 'brief');

    const r = await scanCodex();
    // The 5,000-char body must not land in the startup total.
    expect(r!.skills[0].tokens).toBeGreaterThan(r!.skills[0].listingTokens * 5);
    expect(r!.totalTokens).toBe(r!.skills[0].listingTokens + r!.instructionsTokens);
  });

  it('always reports unused detection as unavailable, with a reason', async () => {
    await writeSkill('a', 'Something.');
    const r = await scanCodex();
    expect(r!.unusedDetectionAvailable).toBe(false);
    expect(r!.unusedDetectionReason).toBe(UNUSED_DETECTION_REASON);
    expect(r!.unusedDetectionReason).toMatch(/catalog/);
  });

  it('skips a broken SKILL.md symlink rather than counting a phantom', async () => {
    await writeSkill('good', 'Fine.');
    const bad = join(codexDir(), 'skills', 'bad');
    await mkdir(bad, { recursive: true });
    await symlink('/nonexistent/SKILL.md', join(bad, 'SKILL.md'));

    const r = await scanCodex();
    expect(r!.skills.map((s) => s.name)).toEqual(['good']);
  });

  it('falls back to the flat estimate for a skill with no frontmatter', async () => {
    await writeSkill('bare', null, '# no frontmatter');
    const r = await scanCodex();
    expect(r!.skills[0].listingTokens).toBeGreaterThan(0);
  });

  it('survives an empty ~/.codex with no subdirectories', async () => {
    await mkdir(codexDir(), { recursive: true });
    const r = await scanCodex();
    expect(r).not.toBeNull();
    expect(r!.skills).toEqual([]);
    expect(r!.agents).toEqual([]);
    expect(r!.totalTokens).toBe(0);
  });

  it('survives an unreadable skills directory', async () => {
    await writeSkill('ok', 'Fine.');
    await rm(join(codexDir(), 'plugins'), { recursive: true, force: true });
    const r = await scanCodex();
    expect(r!.skills).toHaveLength(1);
  });
});

describe('CLI flag wiring', () => {
  it('commander maps --no-codex to opts.codex === false, not opts.noCodex', () => {
    // Guards the bug this shipped with first: reading `opts.noCodex` left the
    // flag silently inert, so `--no-codex` still scanned ~/.codex.
    const program = new Command();
    let seen: Record<string, unknown> = {};
    program
      .command('scan')
      .option('--no-codex', 'Skip the ~/.codex scan even if Codex is installed')
      .action((o) => { seen = o; });
    program.parse(['node', 'x', 'scan', '--no-codex']);

    expect(seen.codex).toBe(false);
    expect(seen.noCodex).toBeUndefined();
  });

  it('leaves opts.codex true when the flag is absent', () => {
    const program = new Command();
    let seen: Record<string, unknown> = {};
    program.command('scan').option('--no-codex', '').action((o) => { seen = o; });
    program.parse(['node', 'x', 'scan']);
    expect(seen.codex).toBe(true);
  });
});

describe('formatCodexSummary', () => {
  it('states the unused-detection limit instead of hiding it', async () => {
    await writeSkill('a', 'Something useful.');
    const out = formatCodexSummary((await scanCodex())!);
    expect(out).toMatch(/Unused-skill detection unavailable/);
    expect(out).toMatch(/catalog/);
  });

  it('says explicitly that ~/.codex is never modified', async () => {
    await writeSkill('a', 'Something.');
    const out = formatCodexSummary((await scanCodex())!);
    expect(out).toMatch(/never modifies/);
  });

  it('truncates an over-long skill name so the token column stays aligned', async () => {
    await writeSkill('humanize-korean.bak.20260711-100101-verylong', 'Backup copy.');
    const out = formatCodexSummary((await scanCodex())!);
    const row = out.split('\n').find((l) => l.includes('humanize-korean.bak'))!;
    expect(row).toContain('…');
  });
});
