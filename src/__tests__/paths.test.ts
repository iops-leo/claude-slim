import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getClaudeDir,
  getSkillsDir,
  getPluginsDir,
  getProjectsDir,
  getDisabledDir,
  getManifestPath,
} from '../paths.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('paths', () => {
  it('resolves ~/.claude from HOME env', () => {
    vi.stubEnv('HOME', '/tmp/fake-home');
    expect(getClaudeDir()).toBe('/tmp/fake-home/.claude');
  });

  it('resolves skills dir under claude dir', () => {
    vi.stubEnv('HOME', '/tmp/fake-home');
    expect(getSkillsDir()).toBe('/tmp/fake-home/.claude/skills');
  });

  it('resolves plugins cache dir', () => {
    vi.stubEnv('HOME', '/tmp/fake-home');
    expect(getPluginsDir()).toBe('/tmp/fake-home/.claude/plugins/cache');
  });

  it('resolves projects dir', () => {
    vi.stubEnv('HOME', '/tmp/fake-home');
    expect(getProjectsDir()).toBe('/tmp/fake-home/.claude/projects');
  });

  it('resolves disabled dir', () => {
    vi.stubEnv('HOME', '/tmp/fake-home');
    expect(getDisabledDir()).toBe('/tmp/fake-home/.claude/skills.disabled');
  });

  it('resolves manifest path under disabled dir', () => {
    vi.stubEnv('HOME', '/tmp/fake-home');
    expect(getManifestPath()).toBe('/tmp/fake-home/.claude/skills.disabled/manifest.json');
  });

  it('re-reads HOME on each call (not cached)', () => {
    vi.stubEnv('HOME', '/tmp/home-a');
    expect(getClaudeDir()).toBe('/tmp/home-a/.claude');
    vi.stubEnv('HOME', '/tmp/home-b');
    expect(getClaudeDir()).toBe('/tmp/home-b/.claude');
  });
});
