import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  checkForUpdate,
  compareVersions,
  detectInstallMethod,
  upgradeCommandFor,
  formatUpdateNotice,
  type UpdateCheckResult,
} from '../update-check.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
});

afterEach(async () => {
  await tmp.cleanup();
});

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('2.8.1', '2.8.0')).toBeGreaterThan(0);
    expect(compareVersions('2.8.0', '2.9.0')).toBeLessThan(0);
    expect(compareVersions('3.0.0', '2.99.99')).toBeGreaterThan(0);
    expect(compareVersions('2.8.1', '2.8.1')).toBe(0);
  });

  it('compares numerically, not lexically', () => {
    // The bug a naive string compare would introduce: "2.10.0" < "2.9.0".
    expect(compareVersions('2.10.0', '2.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.100.0', '2.99.0')).toBeGreaterThan(0);
  });

  it('tolerates a leading v and stray whitespace', () => {
    expect(compareVersions('v2.8.1', ' 2.8.0 ')).toBeGreaterThan(0);
  });

  it('sorts a pre-release below its release', () => {
    expect(compareVersions('2.9.0-beta.1', '2.9.0')).toBeLessThan(0);
    expect(compareVersions('2.9.0', '2.9.0-beta.1')).toBeGreaterThan(0);
  });

  it('treats missing segments as zero', () => {
    expect(compareVersions('2.8', '2.8.0')).toBe(0);
    expect(compareVersions('3', '2.9.9')).toBeGreaterThan(0);
  });
});

describe('detectInstallMethod', () => {
  it('recognises a Claude Code plugin install', () => {
    expect(
      detectInstallMethod('/Users/me/.claude/plugins/cache/claude-slim/claude-slim/2.8.1/dist/update-check.js'),
    ).toBe('plugin');
  });

  it('recognises an npx cache', () => {
    expect(detectInstallMethod('/Users/me/.npm/_npx/abc123/node_modules/claude-slim/dist/x.js')).toBe('npx');
  });

  it('recognises a global npm install', () => {
    expect(detectInstallMethod('/usr/local/lib/node_modules/claude-slim/dist/update-check.js')).toBe('global');
  });

  it('recognises a source checkout', () => {
    expect(detectInstallMethod('/Users/me/project/claude-slim/dist/update-check.js')).toBe('source');
  });

  it('normalises Windows separators', () => {
    expect(
      detectInstallMethod('C:\\Users\\me\\.claude\\plugins\\cache\\claude-slim\\dist\\x.js'),
    ).toBe('plugin');
  });
});

describe('upgradeCommandFor', () => {
  it('uses the plugin@marketplace id, which is what actually resolves', () => {
    // `claude plugin update claude-slim` fails with "not found" when the
    // marketplace shares the plugin name — the qualified id is required.
    expect(upgradeCommandFor('plugin')).toContain('claude-slim@claude-slim');
  });

  it('maps every other method to a runnable command', () => {
    expect(upgradeCommandFor('global')).toBe('npm install -g claude-slim@latest');
    expect(upgradeCommandFor('npx')).toContain('npx');
    expect(upgradeCommandFor('source')).toContain('git pull');
    expect(upgradeCommandFor('unknown')).toBeNull();
  });
});

describe('checkForUpdate', () => {
  const base = { installed: '2.0.0', modulePath: '/x/dist/update-check.js' };

  it('flags an outdated install', async () => {
    const r = await checkForUpdate({
      ...base,
      cachePath: join(tmp.claudeDir, 'c.json'),
      fetchLatest: async () => '2.8.1',
    });
    expect(r.outdated).toBe(true);
    expect(r.latest).toBe('2.8.1');
    expect(r.installed).toBe('2.0.0');
  });

  it('does not flag a current install', async () => {
    const r = await checkForUpdate({
      ...base,
      installed: '2.8.1',
      cachePath: join(tmp.claudeDir, 'c.json'),
      fetchLatest: async () => '2.8.1',
    });
    expect(r.outdated).toBe(false);
  });

  it('does not flag an install ahead of the registry', async () => {
    const r = await checkForUpdate({
      ...base,
      installed: '2.9.0-dev',
      cachePath: join(tmp.claudeDir, 'c.json'),
      fetchLatest: async () => '2.8.1',
    });
    expect(r.outdated).toBe(false);
  });

  it('fails open when the registry is unreachable', async () => {
    const r = await checkForUpdate({
      ...base,
      cachePath: join(tmp.claudeDir, 'c.json'),
      fetchLatest: async () => null,
    });
    // Critically: latest unknown must NOT read as "up to date"...
    expect(r.latest).toBeNull();
    // ...and must never be reported as outdated either.
    expect(r.outdated).toBe(false);
  });

  it('never throws when the fetch itself rejects', async () => {
    const r = await checkForUpdate({
      ...base,
      cachePath: join(tmp.claudeDir, 'c.json'),
      fetchLatest: async () => {
        throw new Error('ENOTFOUND registry.npmjs.org');
      },
    }).catch(() => null);
    // A network failure must not take down `doctor`.
    expect(r).not.toBeNull();
  });

  it('serves a fresh cache without re-querying', async () => {
    const cachePath = join(tmp.claudeDir, 'c.json');
    let calls = 0;
    const fetchLatest = async () => {
      calls++;
      return '2.8.1';
    };

    await checkForUpdate({ ...base, cachePath, fetchLatest, now: 1_000 });
    const second = await checkForUpdate({ ...base, cachePath, fetchLatest, now: 2_000 });

    expect(calls).toBe(1);
    expect(second.fromCache).toBe(true);
    expect(second.outdated).toBe(true);
  });

  it('re-queries once the cache is stale', async () => {
    const cachePath = join(tmp.claudeDir, 'c.json');
    let calls = 0;
    const fetchLatest = async () => {
      calls++;
      return '2.8.1';
    };
    const ttlMs = 1_000;

    await checkForUpdate({ ...base, cachePath, fetchLatest, now: 0, ttlMs });
    await checkForUpdate({ ...base, cachePath, fetchLatest, now: 5_000, ttlMs });

    expect(calls).toBe(2);
  });

  it('force bypasses a fresh cache', async () => {
    const cachePath = join(tmp.claudeDir, 'c.json');
    let calls = 0;
    const fetchLatest = async () => {
      calls++;
      return '2.8.1';
    };

    await checkForUpdate({ ...base, cachePath, fetchLatest, now: 1_000 });
    const forced = await checkForUpdate({ ...base, cachePath, fetchLatest, now: 1_001, force: true });

    expect(calls).toBe(2);
    expect(forced.fromCache).toBe(false);
  });

  it('persists the cache atomically, leaving no .tmp residue', async () => {
    const cachePath = join(tmp.claudeDir, 'c.json');
    await checkForUpdate({ ...base, cachePath, fetchLatest: async () => '2.8.1', now: 42 });

    const parsed = JSON.parse(await readFile(cachePath, 'utf-8'));
    expect(parsed).toEqual({ version: 1, checkedAt: 42, latest: '2.8.1' });
    await expect(readFile(`${cachePath}.tmp`, 'utf-8')).rejects.toThrow();
  });

  it('caches a failed lookup so an offline machine is not re-probed each run', async () => {
    const cachePath = join(tmp.claudeDir, 'c.json');
    let calls = 0;
    const fetchLatest = async () => {
      calls++;
      return null;
    };

    await checkForUpdate({ ...base, cachePath, fetchLatest, now: 1_000 });
    await checkForUpdate({ ...base, cachePath, fetchLatest, now: 1_500 });

    expect(calls).toBe(1);
  });
});

describe('formatUpdateNotice', () => {
  const make = (o: Partial<UpdateCheckResult>): UpdateCheckResult => ({
    installed: '2.0.0',
    latest: '2.8.1',
    outdated: true,
    installMethod: 'plugin',
    upgradeCommand: 'claude plugin update claude-slim@claude-slim',
    fromCache: false,
    ...o,
  });

  it('names both versions and the upgrade command', () => {
    const notice = formatUpdateNotice(make({}))!;
    expect(notice).toContain('2.0.0');
    expect(notice).toContain('2.8.1');
    expect(notice).toContain('claude plugin update');
  });

  it('stays silent when current', () => {
    expect(formatUpdateNotice(make({ outdated: false }))).toBeNull();
  });

  it('stays silent when the lookup failed', () => {
    expect(formatUpdateNotice(make({ latest: null, outdated: false }))).toBeNull();
  });
});
