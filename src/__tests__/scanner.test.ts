import { describe, it, expect, beforeAll } from 'vitest';
import { initTokenizer } from '../tokenizer.js';
import { parseClaudeMdSections, dedupeBySymlink, parseDisabledPlugins } from '../scanner.js';
import type { SkillInfo } from '../types.js';

beforeAll(async () => {
  await initTokenizer();
});

describe('parseClaudeMdSections', () => {
  it('returns empty for empty content', () => {
    expect(parseClaudeMdSections('')).toEqual([]);
  });

  it('returns single preamble when no headers', () => {
    const result = parseClaudeMdSections('just some text\nno headers here\n');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('(preamble)');
    expect(result[0].sizeBytes).toBeGreaterThan(0);
  });

  it('parses single section', () => {
    const result = parseClaudeMdSections('# My Section\nsome content\n');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('My Section');
  });

  it('parses multiple sections', () => {
    const content = '# First\ncontent1\n# Second\ncontent2\n# Third\ncontent3\n';
    const result = parseClaudeMdSections(content);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.name)).toEqual(['First', 'Second', 'Third']);
  });

  it('captures preamble before first header', () => {
    const content = 'preamble text\n\n# Main Section\nbody\n';
    const result = parseClaudeMdSections(content);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('(preamble)');
    expect(result[1].name).toBe('Main Section');
  });

  it('does not split on ## headers', () => {
    const content = '# Top\n## Sub1\ncontent\n## Sub2\ncontent\n';
    const result = parseClaudeMdSections(content);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Top');
  });

  it('truncates long section names to 60 chars', () => {
    const longName = 'A'.repeat(80);
    const content = `# ${longName}\ncontent\n`;
    const result = parseClaudeMdSections(content);
    expect(result[0].name).toHaveLength(60);
  });

  it('calculates token counts for each section', () => {
    const content = '# Short\na\n# Long\n' + 'word '.repeat(500) + '\n';
    const result = parseClaudeMdSections(content);
    expect(result).toHaveLength(2);
    expect(result[1].tokens).toBeGreaterThan(result[0].tokens);
  });

  it('section sizes sum approximately to total', () => {
    const content = '# A\ncontent a\n# B\ncontent b with more text\n';
    const result = parseClaudeMdSections(content);
    const totalSectionBytes = result.reduce((s, r) => s + r.sizeBytes, 0);
    const actualBytes = Buffer.byteLength(content);
    // Allow small difference from trailing newline handling
    expect(Math.abs(totalSectionBytes - actualBytes)).toBeLessThan(10);
  });
});

function makeSkill(name: string, tokens = 100): SkillInfo {
  return { name, path: `/fake/${name}`, sizeBytes: tokens * 4, tokens, source: 'local' };
}

describe('dedupeBySymlink', () => {
  it('keeps unique skills unchanged', () => {
    const result = dedupeBySymlink([
      { skill: makeSkill('a'), realMdPath: '/real/a/SKILL.md' },
      { skill: makeSkill('b'), realMdPath: '/real/b/SKILL.md' },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name).sort()).toEqual(['a', 'b']);
  });

  it('deduplicates skills sharing a realpath', () => {
    const real = '/real/ship/SKILL.md';
    const result = dedupeBySymlink([
      { skill: makeSkill('ship'), realMdPath: real },
      { skill: makeSkill('gstack/ship'), realMdPath: real },
    ]);
    expect(result).toHaveLength(1);
  });

  it('prefers top-level name over nested when deduping', () => {
    const real = '/real/ship/SKILL.md';
    // Nested first, then top-level
    const result = dedupeBySymlink([
      { skill: makeSkill('gstack/ship'), realMdPath: real },
      { skill: makeSkill('ship'), realMdPath: real },
    ]);
    expect(result[0].name).toBe('ship');
  });

  it('keeps top-level name when it was seen first', () => {
    const real = '/real/ship/SKILL.md';
    const result = dedupeBySymlink([
      { skill: makeSkill('ship'), realMdPath: real },
      { skill: makeSkill('gstack/ship'), realMdPath: real },
    ]);
    expect(result[0].name).toBe('ship');
  });

  it('handles mix of duplicates and unique skills', () => {
    const shipReal = '/real/ship/SKILL.md';
    const result = dedupeBySymlink([
      { skill: makeSkill('ship'), realMdPath: shipReal },
      { skill: makeSkill('gstack/ship'), realMdPath: shipReal },
      { skill: makeSkill('unique'), realMdPath: '/real/unique/SKILL.md' },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name).sort()).toEqual(['ship', 'unique']);
  });
});

describe('parseDisabledPlugins', () => {
  it('returns empty set for empty output', () => {
    expect(parseDisabledPlugins('').size).toBe(0);
  });

  it('extracts marketplace name from sub-plugin@marketplace entries', () => {
    const output = [
      '❯ alpha@marketplace-one',
      '  disabled',
      '❯ beta@marketplace-two',
      '  enabled',
    ].join('\n');
    const result = parseDisabledPlugins(output);
    expect(result.has('marketplace-one')).toBe(true);
    expect(result.has('marketplace-two')).toBe(false);
  });

  it('falls back to full name when no @ separator', () => {
    const output = '❯ solo-plugin\n  disabled\n';
    const result = parseDisabledPlugins(output);
    expect(result.has('solo-plugin')).toBe(true);
  });

  it('handles mixed enabled/disabled entries', () => {
    const output = [
      '❯ a@m1',
      '  enabled',
      '❯ b@m2',
      '  disabled',
      '❯ c@m3',
      '  disabled',
    ].join('\n');
    const result = parseDisabledPlugins(output);
    expect(Array.from(result).sort()).toEqual(['m2', 'm3']);
  });

  it('is case-insensitive for enabled/disabled tokens', () => {
    const output = '❯ a@m1\n  DISABLED\n❯ b@m2\n  Enabled\n';
    expect(parseDisabledPlugins(output).has('m1')).toBe(true);
    expect(parseDisabledPlugins(output).has('m2')).toBe(false);
  });

  it('ignores dangling status line without a preceding entry', () => {
    const output = 'some preamble\n  disabled\n';
    expect(parseDisabledPlugins(output).size).toBe(0);
  });
});
