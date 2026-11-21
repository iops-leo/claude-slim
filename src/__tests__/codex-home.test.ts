import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { dir } from 'tmp-promise';
import { getCodexDir, getAgentRoot, agentForPath, assertInsideAgentRoot } from '../paths.js';
import { getCodexDir as codexScannerDir, scanCodex } from '../codex/index.js';

/** Codex reads its home from CODEX_HOME, defaulting to ~/.codex. */

let home: string;
let cleanup: () => Promise<void>;
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

describe('CODEX_HOME', () => {
  it('defaults to ~/.codex', () => {
    expect(getCodexDir()).toBe(join(home, '.codex'));
  });

  it('is honoured by the path guard and the scanner alike', async () => {
    const codexHome = join(home, 'elsewhere', 'codex');
    vi.stubEnv('CODEX_HOME', codexHome);
    expect(getCodexDir()).toBe(codexHome);
    expect(codexScannerDir()).toBe(codexHome);
    expect(getAgentRoot('codex')).toBe(codexHome);
    expect(agentForPath(join(codexHome, 'skills', 'x'))).toBe('codex');
    expect(() => assertInsideAgentRoot(join(home, '.codex', 'skills', 'x'), 'codex')).toThrow();

    await mkdir(join(codexHome, 'skills', 'mine'), { recursive: true });
    await writeFile(join(codexHome, 'skills', 'mine', 'SKILL.md'), '---\nname: mine\ndescription: d\n---\n');
    const scan = await scanCodex();
    expect(scan?.skills.map((s) => s.name)).toEqual(['mine']);
  });

  it('resolves a relative value against the cwd', () => {
    vi.stubEnv('CODEX_HOME', 'rel/codex');
    expect(getCodexDir()).toBe(resolve('rel/codex'));
  });
});
