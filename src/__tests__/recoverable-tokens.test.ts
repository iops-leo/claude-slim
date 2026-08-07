import { describe, it, expect } from 'vitest';
import { sumRecoverableStartupTokens } from '../scanner/index.js';
import type { Issue, SkillInfo } from '../types.js';

/**
 * Regression guard for an inflated savings figure.
 *
 * SKILL.md asks the model to report "estimated total token savings", and the
 * only per-item number the JSON offered was `Issue.tokens`. Summing it is wrong
 * twice over: detectors flag one skill several times, and `tokens` is the whole
 * SKILL.md body rather than the catalog line startup actually pays for. On a
 * real machine that sum came to 215,535 tokens of "savings" against a
 * 13,434-token startup total — a saving 16× larger than the entire cost.
 */

const skill = (name: string, tokens: number, listingTokens: number): SkillInfo => ({
  name,
  path: `/skills/${name}`,
  sizeBytes: tokens * 4,
  tokens,
  listingTokens,
  source: 'local',
});

const issue = (type: Issue['type'], name: string, tokens: number, path: string): Issue =>
  ({ type, tier: 3, name, tokens, path });

describe('sumRecoverableStartupTokens', () => {
  it('counts a multiply-flagged skill once', () => {
    const skills = [skill('skillify', 16683, 120)];
    const issues = [
      issue('duplicate', 'skillify', 16683, '/skills/skillify'),
      issue('oversized_skill', 'skillify', 16683, '/skills/skillify'),
      issue('unused_skill', 'skillify', 16683, '/skills/skillify'),
    ];
    expect(sumRecoverableStartupTokens(issues, skills, '-none')).toBe(120);
  });

  it('uses listing tokens, not the SKILL.md body', () => {
    const skills = [skill('big', 24778, 90)];
    const issues = [issue('unused_skill', 'big', 24778, '/skills/big')];
    const total = sumRecoverableStartupTokens(issues, skills, '-none');
    expect(total).toBe(90);
    expect(total).not.toBe(24778);
  });

  it('adds up distinct skills', () => {
    const skills = [skill('a', 1000, 30), skill('b', 2000, 45)];
    const issues = [
      issue('unused_skill', 'a', 1000, '/skills/a'),
      issue('oversized_skill', 'b', 2000, '/skills/b'),
    ];
    expect(sumRecoverableStartupTokens(issues, skills, '-none')).toBe(75);
  });

  it('counts current-project memory but not another project\'s', () => {
    // stale_project.tokens is the sum of that project's memory files, so it is
    // necessarily >= any single oversized file inside it (7,100 = 6,371 + rest).
    const issues = [
      issue('oversized_memory', '-Users-me-app/MEMORY.md', 6371, '/m/1'),
      issue('oversized_memory', '-Users-me-other/MEMORY.md', 5000, '/m/2'),
      issue('stale_project', '-Users-me-app', 7100, '/m/3'),
    ];
    // The other project contributes nothing; the current one is counted once,
    // through the stale-project total that already contains MEMORY.md.
    expect(sumRecoverableStartupTokens(issues, [], '-Users-me-app')).toBe(7100);
  });

  it('counts only the current project when nothing is stale', () => {
    const issues = [
      issue('oversized_memory', '-Users-me-app/MEMORY.md', 6371, '/m/1'),
      issue('oversized_memory', '-Users-me-other/MEMORY.md', 5000, '/m/2'),
    ];
    expect(sumRecoverableStartupTokens(issues, [], '-Users-me-app')).toBe(6371);
  });

  it('does not let a sibling slug pass as the current project', () => {
    // `-Users-me-app2` starts with `-Users-me-app`; a plain prefix test counted it.
    const issues = [issue('oversized_memory', '-Users-me-app2/MEMORY.md', 5000, '/m/1')];
    expect(sumRecoverableStartupTokens(issues, [], '-Users-me-app')).toBe(0);
  });

  it('ignores cleanups that free disk but no context', () => {
    const issues = [
      issue('broken_symlink', 'dead', 0, '/skills/dead/SKILL.md'),
      issue('temp_cache', 'temp_local_x', 0, '/plugins/temp_local_x'),
    ];
    expect(sumRecoverableStartupTokens(issues, [], '-none')).toBe(0);
  });

  it('counts unused plugins, whose tokens are already listing-scale', () => {
    const issues = [issue('unused_plugin', 'claude-hud', 20, '')];
    expect(sumRecoverableStartupTokens(issues, [], '-none')).toBe(20);
  });

  it('counts a plugin once even when several versions are cached', () => {
    // scanPluginSurfaces walks version directories, so a plugin with two cached
    // versions yields two unused_plugin issues — and pluginCosts is keyed by
    // plugin name, so each carries the same aggregate. Adding both billed the
    // plugin's whole cost twice.
    const issues = [
      issue('unused_plugin', 'superpowers', 431, '/cache/mkt/superpowers/1.0.0'),
      issue('unused_plugin', 'superpowers', 431, '/cache/mkt/superpowers/1.1.0'),
    ];
    expect(sumRecoverableStartupTokens(issues, [], '-none')).toBe(431);
  });

  it('does not bill a memory file twice via its stale project', () => {
    // stale_project.tokens is the sum of every memory file in that project;
    // oversized_memory names one of those same files. Counting both charged
    // the oversized file twice and could exceed the project's whole memory.
    const issues = [
      issue('stale_project', '-Users-me-app', 9000, '/p/app'),
      issue('oversized_memory', '-Users-me-app/MEMORY.md', 6371, '/p/app/memory/MEMORY.md'),
    ];
    expect(sumRecoverableStartupTokens(issues, [], '-Users-me-app')).toBe(9000);
  });

  it('still counts an oversized memory file when its project is not stale', () => {
    const issues = [
      issue('oversized_memory', '-Users-me-app/MEMORY.md', 6371, '/p/app/memory/MEMORY.md'),
    ];
    expect(sumRecoverableStartupTokens(issues, [], '-Users-me-app')).toBe(6371);
  });

  it('never exceeds the current project\'s total memory', () => {
    // The property both double-counts violated.
    const projectMemoryTotal = 9000;
    const issues = [
      issue('stale_project', '-Users-me-app', projectMemoryTotal, '/p/app'),
      issue('oversized_memory', '-Users-me-app/a.md', 6371, '/p/app/memory/a.md'),
      issue('oversized_memory', '-Users-me-app/b.md', 2000, '/p/app/memory/b.md'),
    ];
    expect(sumRecoverableStartupTokens(issues, [], '-Users-me-app'))
      .toBeLessThanOrEqual(projectMemoryTotal);
  });

  it('stays within the startup total it is a fraction of', () => {
    // The property that failed in production: recoverable must never exceed
    // what the listings actually cost.
    const skills = [skill('a', 50000, 40), skill('b', 90000, 60)];
    const listingTotal = 40 + 60;
    const issues = [
      issue('duplicate', 'a', 50000, '/skills/a'),
      issue('unused_skill', 'a', 50000, '/skills/a'),
      issue('oversized_skill', 'b', 90000, '/skills/b'),
    ];
    expect(sumRecoverableStartupTokens(issues, skills, '-none')).toBeLessThanOrEqual(listingTotal);
  });

  it('contributes nothing for a skill absent from the listing map', () => {
    const issues = [issue('unused_skill', 'ghost', 999, '/skills/ghost')];
    expect(sumRecoverableStartupTokens(issues, [], '-none')).toBe(0);
  });

  it('never exceeds the startup cost of everything it could remove', () => {
    // The invariant behind all three collapses. Every overlap type is present
    // here at once: one skill flagged twice, one plugin cached twice, and a
    // memory file inside its own stale project.
    const skills = [skill('dup', 40000, 70)];
    const issues = [
      issue('duplicate', 'dup', 40000, '/skills/dup'),
      issue('unused_skill', 'dup', 40000, '/skills/dup'),
      issue('unused_plugin', 'multi', 300, '/cache/m/multi/1.0.0'),
      issue('unused_plugin', 'multi', 300, '/cache/m/multi/2.0.0'),
      issue('stale_project', '-Users-me-app', 5000, '/p/app'),
      issue('oversized_memory', '-Users-me-app/MEMORY.md', 4000, '/p/app/m/MEMORY.md'),
    ];
    const ceiling = 70 + 300 + 5000;
    expect(sumRecoverableStartupTokens(issues, skills, '-Users-me-app')).toBe(ceiling);
  });
});
