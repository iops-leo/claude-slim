import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { dir } from 'tmp-promise';
import {
  assertInsideAgentRoot,
  assertInsideClaudeDir,
  agentForPath,
  getAgentRoot,
  getAgentDisabledDir,
} from '../paths.js';

/**
 * This guard is what stands between a tampered manifest and `rm -rf` on
 * something that matters. Extending claude-slim to a second agent widened what
 * destructive operations can reach, so the cross-agent cases below are the
 * point of this file: a Codex issue must never resolve into ~/.claude/, and
 * vice versa.
 */

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

describe('assertInsideAgentRoot — accepts what it should', () => {
  it('allows the agent root itself', () => {
    expect(() => assertInsideAgentRoot(join(home, '.claude'), 'claude')).not.toThrow();
    expect(() => assertInsideAgentRoot(join(home, '.codex'), 'codex')).not.toThrow();
  });

  it('allows paths nested under the agent root', () => {
    expect(() => assertInsideAgentRoot(join(home, '.claude', 'skills', 'x'), 'claude')).not.toThrow();
    expect(() => assertInsideAgentRoot(join(home, '.codex', 'skills', 'x'), 'codex')).not.toThrow();
  });
});

describe('assertInsideAgentRoot — cross-agent isolation', () => {
  it('refuses a Codex path when acting as Claude', () => {
    expect(() => assertInsideAgentRoot(join(home, '.codex', 'skills', 'x'), 'claude')).toThrow(
      /outside ~\/\.claude\//,
    );
  });

  it('refuses a Claude path when acting as Codex', () => {
    expect(() => assertInsideAgentRoot(join(home, '.claude', 'skills', 'x'), 'codex')).toThrow(
      /outside ~\/\.codex\//,
    );
  });

  it('refuses the other agent root exactly', () => {
    expect(() => assertInsideAgentRoot(join(home, '.codex'), 'claude')).toThrow();
    expect(() => assertInsideAgentRoot(join(home, '.claude'), 'codex')).toThrow();
  });
});

describe('assertInsideAgentRoot — escapes', () => {
  it('refuses traversal back out of the root', () => {
    expect(() => assertInsideAgentRoot(join(home, '.claude', '..', '.ssh'), 'claude')).toThrow();
    expect(() => assertInsideAgentRoot(join(home, '.codex', '..', '..', 'etc'), 'codex')).toThrow();
  });

  it('refuses traversal that lands in the other agent', () => {
    expect(() => assertInsideAgentRoot(join(home, '.claude', '..', '.codex', 'x'), 'claude')).toThrow();
  });

  it('refuses unrelated absolute paths', () => {
    for (const p of ['/etc/passwd', '/', join(home, 'Documents'), join(home, '.ssh', 'id_rsa')]) {
      expect(() => assertInsideAgentRoot(p, 'claude')).toThrow();
      expect(() => assertInsideAgentRoot(p, 'codex')).toThrow();
    }
  });

  it('refuses a sibling whose name merely starts with the root', () => {
    // ~/.claude-backup must not pass a naive startsWith check.
    expect(() => assertInsideAgentRoot(`${join(home, '.claude')}-backup`, 'claude')).toThrow();
    expect(() => assertInsideAgentRoot(`${join(home, '.codex')}-old`, 'codex')).toThrow();
  });
});

describe('assertInsideClaudeDir — unchanged behaviour for existing callers', () => {
  it('still allows Claude paths and refuses everything else', () => {
    expect(() => assertInsideClaudeDir(join(home, '.claude', 'skills'))).not.toThrow();
    expect(() => assertInsideClaudeDir(join(home, '.codex', 'skills'))).toThrow();
    expect(() => assertInsideClaudeDir('/etc/passwd')).toThrow();
  });
});

describe('agentForPath', () => {
  it('identifies each agent', () => {
    expect(agentForPath(join(home, '.claude', 'skills', 'a'))).toBe('claude');
    expect(agentForPath(join(home, '.codex', 'skills', 'a'))).toBe('codex');
  });

  it('returns null for anything else', () => {
    expect(agentForPath('/etc/passwd')).toBeNull();
    expect(agentForPath(join(home, 'Documents'))).toBeNull();
    expect(agentForPath(`${join(home, '.claude')}-backup`)).toBeNull();
  });
});

describe('agent roots', () => {
  it('resolves distinct roots and disabled directories', () => {
    expect(getAgentRoot('claude')).toBe(join(home, '.claude'));
    expect(getAgentRoot('codex')).toBe(join(home, '.codex'));
    expect(getAgentDisabledDir('claude')).toBe(join(home, '.claude', 'skills.disabled'));
    expect(getAgentDisabledDir('codex')).toBe(join(home, '.codex', 'skills.disabled'));
  });
});
