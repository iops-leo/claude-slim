import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';
import { scanSyncedSkills } from '../scanner/synced-skills.js';
import { resolveProjectMemory } from '../scanner/project-memory.js';
import { readSettingsSources } from '../scanner/settings-sources.js';
import { scanLocalSkills } from '../scanner/local-skills.js';

const ORG = 'c52823c9-414d-4d98-abf3-51ba97a3cf64';
const ACCT = 'c63aa844-994f-454f-bde3-e387c7b0f03f';

describe('synced claude.ai skills', () => {
  let tmp: TmpClaude;
  let project: string;
  let managedDir: string;
  beforeAll(async () => { await initTokenizer(); });
  beforeEach(async () => {
    tmp = await createTmpClaude();
    project = join(tmp.home, 'code', 'app');
    managedDir = join(tmp.home, 'managed');
    await mkdir(project, { recursive: true });
    await mkdir(managedDir, { recursive: true });
  });
  afterEach(async () => { await tmp.cleanup(); });

  async function bucket(name: string, skills: string[], manifest = true): Promise<void> {
    const dir = join(tmp.skillsDir, 'synced', name);
    for (const s of skills) {
      await mkdir(join(dir, s), { recursive: true });
      await writeFile(join(dir, s, 'SKILL.md'), `---\nname: ${s}\ndescription: ${s} skill\n---\nbody\n`);
    }
    if (manifest) {
      await writeFile(join(dir, 'manifest.json'), JSON.stringify({ skills: skills.map((s) => ({ skillId: s, name: s })) }));
    }
  }
  async function signIn(org = ORG, acct = ACCT): Promise<void> {
    await writeFile(join(tmp.home, '.claude.json'), JSON.stringify({ oauthAccount: { organizationUuid: org, accountUuid: acct } }));
  }
  const scan = async () => scanSyncedSkills(await readSettingsSources(project, managedDir));

  it('loads only the signed-in account\'s bucket, under the anthropic-skills namespace', async () => {
    await bucket(`${ORG}_${ACCT}`, ['pdf', 'xlsx']);
    await bucket(`${ORG}_other-account`, ['pdf', 'xlsx']);
    await bucket('old-org_old-acct', ['pdf', 'mcp-builder', 'canvas-design']);
    await signIn();
    const r = await scan();
    expect(r.active.map((s) => s.name).sort()).toEqual(['anthropic-skills:pdf', 'anthropic-skills:xlsx']);
    expect(r.active.every((s) => s.source === 'synced' && s.listingTokens > 0)).toBe(true);
    expect(r.inactive.map((b) => [b.skills, b.reason]).sort()).toEqual([[2, 'other account'], [3, 'other account']]);
  });

  it('skips skill folders the bucket manifest no longer lists', async () => {
    await bucket(`${ORG}_${ACCT}`, ['pdf']);
    await mkdir(join(tmp.skillsDir, 'synced', `${ORG}_${ACCT}`, 'stale'), { recursive: true });
    await writeFile(join(tmp.skillsDir, 'synced', `${ORG}_${ACCT}`, 'stale', 'SKILL.md'), '---\nname: stale\n---\n');
    await signIn();
    expect((await scan()).active.map((s) => s.name)).toEqual(['anthropic-skills:pdf']);
  });

  it('loads nothing when not signed in with a claude.ai account', async () => {
    await bucket(`${ORG}_${ACCT}`, ['pdf']);
    const r = await scan();
    expect(r.active).toEqual([]);
    expect(r.inactive[0].reason).toBe('not signed in');
  });

  it('loads nothing when syncClaudeAiSkills is false in user settings', async () => {
    await bucket(`${ORG}_${ACCT}`, ['pdf']);
    await signIn();
    await writeFile(join(tmp.claudeDir, 'settings.json'), JSON.stringify({ syncClaudeAiSkills: false }));
    const r = await scan();
    expect(r.active).toEqual([]);
    expect(r.inactive[0].reason).toBe('sync off');
  });

  it('ignores syncClaudeAiSkills: false in the shared project file (a repo cannot turn it off)', async () => {
    await bucket(`${ORG}_${ACCT}`, ['pdf']);
    await signIn();
    await mkdir(join(project, '.claude'), { recursive: true });
    await writeFile(join(project, '.claude', 'settings.json'), JSON.stringify({ syncClaudeAiSkills: false }));
    expect((await scan()).active).toHaveLength(1);
  });

  it('matches the bucket case-insensitively', async () => {
    await bucket(`${ORG}_${ACCT}`, ['pdf']);
    await signIn(ORG.toUpperCase(), ACCT.toUpperCase());
    expect((await scan()).active).toHaveLength(1);
  });

  it('loads nothing when managed settings lock skills to plugins', async () => {
    await bucket(`${ORG}_${ACCT}`, ['pdf']);
    await signIn();
    await writeFile(join(managedDir, 'managed-settings.json'), JSON.stringify({ strictPluginOnlyCustomization: ['skills'] }));
    expect((await scan()).active).toEqual([]);
  });

  it('prices a synced skill under its full name when the short name is taken', async () => {
    await bucket(`${ORG}_${ACCT}`, ['deploy']);
    await signIn();
    const src = await readSettingsSources(project, managedDir);
    const free = (await scanSyncedSkills(src)).active[0].listingTokens;
    const taken = (await scanSyncedSkills(src, new Set(['deploy']))).active[0].listingTokens;
    expect(taken).toBeGreaterThan(free);
  });

  it('keeps the local skill walk out of synced/ entirely', async () => {
    await bucket(`${ORG}_${ACCT}`, ['pdf']);
    const { skills } = await scanLocalSkills();
    expect(skills).toEqual([]);
  });
});

describe('resolveProjectMemory', () => {
  let tmp: TmpClaude;
  let repo: string;
  beforeEach(async () => {
    tmp = await createTmpClaude();
    repo = join(tmp.home, 'code', 'repo');
    await mkdir(join(repo, '.git'), { recursive: true });
    await mkdir(join(repo, 'src', 'deep'), { recursive: true });
  });
  afterEach(async () => { await tmp.cleanup(); vi.unstubAllEnvs(); });

  const slug = (p: string): string => p.replace(/[^A-Za-z0-9]/g, '-');

  it('uses the git repository root, so subdirectories share its memory', async () => {
    await mkdir(join(tmp.projectsDir, slug(repo), 'memory'), { recursive: true });
    const m = await resolveProjectMemory(await readSettingsSources(join(repo, 'src', 'deep')));
    expect(m.slug).toBe(slug(repo));
    expect(m.disabled).toBe(false);
  });

  it('uses the main checkout for a linked worktree', async () => {
    const wt = join(repo, '.worktrees', 'feat');
    await mkdir(join(repo, '.git', 'worktrees', 'feat'), { recursive: true });
    await mkdir(wt, { recursive: true });
    await writeFile(join(wt, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'feat')}\n`);
    await writeFile(join(repo, '.git', 'worktrees', 'feat', 'commondir'), '../..\n');
    const m = await resolveProjectMemory(await readSettingsSources(wt));
    expect(m.slug).toBe(slug(repo));
  });

  it('falls back to the working directory outside a repository', async () => {
    const plain = join(tmp.home, 'plain');
    await mkdir(plain, { recursive: true });
    const m = await resolveProjectMemory(await readSettingsSources(plain));
    expect(m.slug).toBe(slug(plain));
  });

  it('reports auto memory as off via autoMemoryEnabled or CLAUDE_CODE_DISABLE_AUTO_MEMORY', async () => {
    await writeFile(join(tmp.claudeDir, 'settings.json'), JSON.stringify({ autoMemoryEnabled: false }));
    expect((await resolveProjectMemory(await readSettingsSources(repo))).disabled).toBe(true);
    await writeFile(join(tmp.claudeDir, 'settings.json'), '{}');
    vi.stubEnv('CLAUDE_CODE_DISABLE_AUTO_MEMORY', '1');
    expect((await resolveProjectMemory(await readSettingsSources(repo))).disabled).toBe(true);
  });

  it('lets CLAUDE_CODE_DISABLE_AUTO_MEMORY=0 force memory on over autoMemoryEnabled: false', async () => {
    await writeFile(join(tmp.claudeDir, 'settings.json'), JSON.stringify({ autoMemoryEnabled: false }));
    vi.stubEnv('CLAUDE_CODE_DISABLE_AUTO_MEMORY', '0');
    expect((await resolveProjectMemory(await readSettingsSources(repo))).disabled).toBe(false);
  });

  it('does not fall back to an old per-subdirectory memory folder', async () => {
    await mkdir(join(tmp.projectsDir, slug(join(repo, 'src')), 'memory'), { recursive: true });
    const m = await resolveProjectMemory(await readSettingsSources(join(repo, 'src')));
    expect(m.slug).toBe(slug(repo));
  });

  it('honours a repo autoMemoryDirectory when a parent folder inside the repo is trusted', async () => {
    const sub = join(repo, 'src');
    await mkdir(join(sub, '.claude'), { recursive: true });
    await writeFile(join(sub, '.claude', 'settings.json'), JSON.stringify({ autoMemoryDirectory: '~/repo-mem' }));
    await writeFile(join(tmp.home, '.claude.json'), JSON.stringify({ projects: { [repo]: { hasTrustDialogAccepted: true } } }));
    const m = await resolveProjectMemory(await readSettingsSources(sub));
    expect(m.customDir).toBe(join(tmp.home, 'repo-mem'));
  });

  it('honours parent-folder trust outside a repository, but not across a nested repo root', async () => {
    const work = join(tmp.home, 'work');
    const app = join(work, 'app');
    await mkdir(join(app, '.claude'), { recursive: true });
    await writeFile(join(app, '.claude', 'settings.json'), JSON.stringify({ autoMemoryDirectory: '~/app-mem' }));
    await writeFile(join(tmp.home, '.claude.json'), JSON.stringify({ projects: { [work]: { hasTrustDialogAccepted: true } } }));
    expect((await resolveProjectMemory(await readSettingsSources(app))).customDir).toBe(join(tmp.home, 'app-mem'));

    await mkdir(join(app, '.git'), { recursive: true }); // app is now its own repo under the trusted parent
    expect((await resolveProjectMemory(await readSettingsSources(app))).customDir).toBeUndefined();
  });

  it('loads no memory from a repo-chosen directory when blockReadsOutsideWorkingDirectories is on', async () => {
    await mkdir(join(repo, '.claude'), { recursive: true });
    await writeFile(join(repo, '.claude', 'settings.json'), JSON.stringify({ autoMemoryDirectory: '~/repo-mem' }));
    await writeFile(join(tmp.claudeDir, 'settings.json'), JSON.stringify({ permissions: { blockReadsOutsideWorkingDirectories: true } }));
    await writeFile(join(tmp.home, '.claude.json'), JSON.stringify({ projects: { [repo]: { hasTrustDialogAccepted: true } } }));
    const m = await resolveProjectMemory(await readSettingsSources(repo));
    expect(m.disabled).toBe(true);
  });

  it('follows autoMemoryDirectory from user settings, expanding ~/', async () => {
    await writeFile(join(tmp.claudeDir, 'settings.json'), JSON.stringify({ autoMemoryDirectory: '~/mem' }));
    const m = await resolveProjectMemory(await readSettingsSources(repo));
    expect(m.customDir).toBe(join(tmp.home, 'mem'));
  });

  it('ignores autoMemoryDirectory from an untrusted project\'s settings', async () => {
    await mkdir(join(repo, '.claude'), { recursive: true });
    await writeFile(join(repo, '.claude', 'settings.json'), JSON.stringify({ autoMemoryDirectory: '/tmp/evil' }));
    const m = await resolveProjectMemory(await readSettingsSources(repo));
    expect(m.customDir).toBeUndefined();
  });
});
