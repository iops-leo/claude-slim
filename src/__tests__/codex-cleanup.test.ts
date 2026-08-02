import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { mkdir, writeFile, readFile, access, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { dir } from 'tmp-promise';
import { scanCodex } from '../codex/index.js';
import { classifyCodexIssues } from '../codex/detectors.js';
import { cleanIssues, restoreItem } from '../cleaner.js';
import { readManifest } from '../manifest.js';
import { initTokenizer } from '../tokenizer.js';
import type { Issue } from '../types.js';

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
const claudeDir = (): string => join(home, '.claude');

async function codexSkill(name: string, body = 'content', description = 'A skill.'): Promise<string> {
  const d = join(codexDir(), 'skills', name);
  await mkdir(d, { recursive: true });
  await writeFile(join(d, 'SKILL.md'), `---\ndescription: ${description}\n---\n${body}`);
  return d;
}

async function claudeSkill(name: string): Promise<string> {
  const d = join(claudeDir(), 'skills', name);
  await mkdir(d, { recursive: true });
  await writeFile(join(d, 'SKILL.md'), `---\ndescription: A claude skill.\n---\nbody`);
  return d;
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function codexIssues(): Promise<Issue[]> {
  const contents = new Map<string, string>();
  const scan = await scanCodex(contents);
  return classifyCodexIssues({ scan: scan!, contents });
}

describe('Codex detectors — same tiers as Claude Code', () => {
  it('flags an unfilled template as Tier 1', async () => {
    await codexSkill('scaffold', 'Replace with description');
    const issues = await codexIssues();
    const t = issues.find((i) => i.type === 'template')!;
    expect(t.tier).toBe(1);
    expect(t.agent).toBe('codex');
  });

  it('flags a dead SKILL.md symlink as Tier 1', async () => {
    const d = join(codexDir(), 'skills', 'dangling');
    await mkdir(d, { recursive: true });
    await symlink('/nonexistent/SKILL.md', join(d, 'SKILL.md'));
    const issues = await codexIssues();
    expect(issues.find((i) => i.type === 'broken_symlink')?.tier).toBe(1);
  });

  it('flags install leftovers in .tmp as Tier 1', async () => {
    await mkdir(join(codexDir(), '.tmp', 'junk'), { recursive: true });
    await writeFile(join(codexDir(), '.tmp', 'junk', 'x'), 'x'.repeat(2048));
    const issues = await codexIssues();
    const tmp = issues.find((i) => i.type === 'temp_cache')!;
    expect(tmp.tier).toBe(1);
    expect(tmp.name).toBe('.tmp');
  });

  it('flags a backup copy as Tier 2', async () => {
    await codexSkill('notes.bak.20260711');
    const issues = await codexIssues();
    expect(issues.find((i) => i.type === 'backup_artifact')?.tier).toBe(2);
  });

  it('flags a local skill shadowed by a plugin one as Tier 2', async () => {
    await codexSkill('shared');
    const p = join(codexDir(), 'plugins', 'cache', 'm', 'p', '1.0.0', 'skills', 'shared');
    await mkdir(p, { recursive: true });
    await writeFile(join(p, 'SKILL.md'), '---\ndescription: plugin copy.\n---\nbody');

    const issues = await codexIssues();
    const dup = issues.find((i) => i.type === 'duplicate')!;
    expect(dup.tier).toBe(2);
    // The local copy is the one offered for removal; the plugin one stays.
    expect(dup.path).toContain(join('.codex', 'skills', 'shared'));
  });

  it('flags an oversized skill as Tier 3', async () => {
    await codexSkill('huge', 'x'.repeat(20_000));
    const issues = await codexIssues();
    expect(issues.find((i) => i.type === 'oversized_skill')?.tier).toBe(3);
  });

  it('never reports unused_skill for Codex', async () => {
    await codexSkill('a');
    await codexSkill('b');
    const issues = await codexIssues();
    expect(issues.some((i) => i.type === 'unused_skill')).toBe(false);
  });

  it('orders issues by tier', async () => {
    await codexSkill('scaffold', 'Replace with description');
    await codexSkill('notes.bak');
    await codexSkill('huge', 'x'.repeat(20_000));
    const tiers = (await codexIssues()).map((i) => i.tier);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
  });
});

describe('Codex cleanup — move and restore round trip', () => {
  it('moves a Codex skill into ~/.codex/skills.disabled and restores it', async () => {
    const src = await codexSkill('notes.bak.20260711');
    const issues = (await codexIssues()).filter((i) => i.type === 'backup_artifact');

    const result = await cleanIssues(issues);
    expect(result.moved).toHaveLength(1);
    expect(await exists(src)).toBe(false);

    const disabled = join(codexDir(), 'skills.disabled', 'notes.bak.20260711');
    expect(await exists(disabled)).toBe(true);
    // It must not have been parked under the Claude store.
    expect(await exists(join(claudeDir(), 'skills.disabled', 'notes.bak.20260711'))).toBe(false);

    await restoreItem(result.moved[0]);
    expect(await exists(src)).toBe(true);
    expect(await exists(disabled)).toBe(false);
  });

  it('records the agent on the manifest entry', async () => {
    await codexSkill('notes.bak');
    const issues = (await codexIssues()).filter((i) => i.type === 'backup_artifact');
    await cleanIssues(issues);

    const manifest = await readManifest();
    const entry = manifest.find((e) => 'name' in e && e.name === 'notes.bak') as { agent?: string };
    expect(entry.agent).toBe('codex');
  });

  it('keeps the two agent stores separate in one run', async () => {
    await codexSkill('shared.bak');
    await claudeSkill('shared.bak');

    const codex = (await codexIssues()).filter((i) => i.type === 'backup_artifact');
    const claudeIssue: Issue = {
      type: 'backup_artifact', tier: 2, name: 'shared.bak',
      path: join(claudeDir(), 'skills', 'shared.bak'), tokens: 1,
    };

    await cleanIssues([...codex, claudeIssue]);

    expect(await exists(join(codexDir(), 'skills.disabled', 'shared.bak'))).toBe(true);
    expect(await exists(join(claudeDir(), 'skills.disabled', 'shared.bak'))).toBe(true);
  });

  it('refuses a Codex-tagged issue whose path points into ~/.claude', async () => {
    await claudeSkill('victim');
    const forged: Issue = {
      type: 'backup_artifact', tier: 2, agent: 'codex', name: 'victim',
      path: join(claudeDir(), 'skills', 'victim'), tokens: 1,
    };

    const result = await cleanIssues([forged]);
    expect(result.moved).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/outside ~\/\.codex\//);
    // The targeted directory must be untouched.
    expect(await exists(join(claudeDir(), 'skills', 'victim'))).toBe(true);
  });

  it('refuses a Claude-tagged issue whose path points into ~/.codex', async () => {
    const src = await codexSkill('victim');
    const forged: Issue = {
      type: 'backup_artifact', tier: 2, agent: 'claude', name: 'victim',
      path: src, tokens: 1,
    };

    const result = await cleanIssues([forged]);
    expect(result.errors[0].error).toMatch(/outside ~\/\.claude\//);
    expect(await exists(src)).toBe(true);
  });

  it('deletes Codex install leftovers outright and marks them unrestorable', async () => {
    const tmp = join(codexDir(), '.tmp');
    await mkdir(join(tmp, 'junk'), { recursive: true });
    await writeFile(join(tmp, 'junk', 'x'), 'x'.repeat(2048));

    const issues = (await codexIssues()).filter((i) => i.type === 'temp_cache');
    const result = await cleanIssues(issues);

    expect(await exists(tmp)).toBe(false);
    await expect(restoreItem(result.moved[0])).rejects.toThrow(/cannot be restored/);
  });
});
