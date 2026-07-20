import { describe, it, expect, beforeAll } from 'vitest';
import { initTokenizer } from '../tokenizer.js';
import { parseClaudeMdSections, dedupeBySymlink, parseDisabledPlugins } from '../scanner.js';
import {
  classifyIssues,
  detectors,
  type Detector,
  type DetectorContext,
} from '../scanner/detectors.js';
import type { SkillInfo, Issue } from '../types.js';

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

function makeCtx(partial: Partial<DetectorContext> = {}): DetectorContext {
  return {
    localSkills: [],
    pluginSkills: [],
    brokenSymlinks: [],
    memoryFiles: [],
    tempCaches: [],
    staleProjects: [],
    disabledPlugins: new Set(),
    plugins: [],
    contents: new Map(),
    recentSkillInvocations: new Set(),
    sessionDataAvailable: false,
    lookbackDays: 60,
    pluginSurfaces: [],
    enabledPlugins: [],
    recentMcpPrefixes: new Set(),
    recentCommands: new Set(),
    totalUserCallableInvocations: 0,
    sessionsInWindow: 0,
    pluginCosts: new Map(),
    ...partial,
  };
}

describe('detector registry', () => {
  it('classifyIssues uses the built-in registry by default', () => {
    const ctx = makeCtx({
      brokenSymlinks: [{ name: 'dead', path: '/fake/dead', target: '/gone' }],
    });
    const issues = classifyIssues(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('broken_symlink');
  });

  it('accepts a custom registry so contributors can add detectors without editing core', () => {
    // This is the extensibility contract documented in CONTRIBUTING.md:
    // writing a new detector is a pure function + one-line append to the
    // registry array. No scanner.ts edits required.
    const fakeDetector: Detector = {
      name: 'fake_issue',
      detect(): Issue[] {
        return [{
          type: 'template',
          tier: 1,
          name: 'fake',
          tokens: 42,
          path: '/fake/path',
        }];
      },
    };
    const extended: Detector[] = [...detectors, fakeDetector];
    const issues = classifyIssues(makeCtx(), extended);
    expect(issues.find((i) => i.name === 'fake')?.tokens).toBe(42);
  });

  it('sorts issues by tier regardless of detector order', () => {
    const brokenLinkDetector = detectors.find((d) => d.name === 'broken_symlink')!;
    const oversizedDetector = detectors.find((d) => d.name === 'oversized_skill')!;
    // Tier-3 detector first, tier-1 second — output must still be tier-1 then tier-3
    const reordered = [oversizedDetector, brokenLinkDetector];
    const ctx = makeCtx({
      brokenSymlinks: [{ name: 'dead', path: '/x', target: '/y' }],
      localSkills: [{
        name: 'huge', path: '/big', sizeBytes: 100000, tokens: 999, source: 'local',
      }],
    });
    const issues = classifyIssues(ctx, reordered);
    expect(issues[0].tier).toBe(1);
    expect(issues[1].tier).toBe(3);
  });
});

describe('unused_skill detector', () => {
  const unusedDetector = detectors.find((d) => d.name === 'unused_skill')!;

  it('returns nothing when sessionDataAvailable is false (suppress on bad data)', () => {
    // Even with skills present and an empty invocation set, refuse to classify
    // anything as unused — the upstream signal said "don't trust me".
    const ctx = makeCtx({
      localSkills: [makeSkill('never-touched')],
      recentSkillInvocations: new Set(),
      sessionDataAvailable: false,
    });
    expect(unusedDetector.detect(ctx)).toEqual([]);
  });

  it('flags local skills missing from the invocation set', () => {
    const ctx = makeCtx({
      localSkills: [makeSkill('idle'), makeSkill('active')],
      recentSkillInvocations: new Set(['active']),
      sessionDataAvailable: true,
      lookbackDays: 60,
    });
    const issues = unusedDetector.detect(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: 'unused_skill',
      tier: 3,
      name: 'idle',
      detail: 'not invoked in 60d',
    });
  });

  it('does not flag plugin skills (out of scope: plugin internals are managed by claude plugin)', () => {
    const pluginSkill: SkillInfo = {
      name: 'brainstorming',
      path: '/fake/plugins/superpowers/skills/brainstorming',
      sizeBytes: 100,
      tokens: 50,
      source: 'plugin',
      pluginName: 'superpowers',
    };
    const ctx = makeCtx({
      pluginSkills: [pluginSkill],
      recentSkillInvocations: new Set(['something-else']),
      sessionDataAvailable: true,
    });
    expect(unusedDetector.detect(ctx)).toEqual([]);
  });

  it('treats nested skill leaf name as a match (gstack/ship invoked as ship)', () => {
    const nested = makeSkill('gstack/ship');
    const ctx = makeCtx({
      localSkills: [nested],
      recentSkillInvocations: new Set(['ship']),
      sessionDataAvailable: true,
    });
    expect(unusedDetector.detect(ctx)).toEqual([]);
  });

  it('reports tokens and path so cleanup can dispatch correctly', () => {
    const skill: SkillInfo = {
      name: 'lonely',
      path: '/fake/skills/lonely',
      sizeBytes: 800,
      tokens: 200,
      source: 'local',
    };
    const ctx = makeCtx({
      localSkills: [skill],
      recentSkillInvocations: new Set(['anything-else']),
      sessionDataAvailable: true,
    });
    const issues = unusedDetector.detect(ctx);
    expect(issues[0].tokens).toBe(200);
    expect(issues[0].path).toBe('/fake/skills/lonely');
  });
});
