import { describe, it, expect, beforeAll } from 'vitest';
import {
  parseFrontmatterDescription,
  listingTokens,
  listingTokensFromContent,
} from '../scanner/skill-listing.js';
import { SKILL_PROMPT_OVERHEAD_TOKENS } from '../scanner/constants.js';
import { initTokenizer } from '../tokenizer.js';

beforeAll(async () => {
  await initTokenizer();
});

describe('parseFrontmatterDescription', () => {
  it('extracts a single-line description', () => {
    const content = [
      '---',
      'name: my-skill',
      'description: Does a specific thing well.',
      '---',
      '',
      '# Body',
    ].join('\n');
    expect(parseFrontmatterDescription(content)).toBe('Does a specific thing well.');
  });

  it('joins a wrapped multi-line description into one line', () => {
    const content = [
      '---',
      'name: my-skill',
      'description: First part of the description',
      '  continued on the next line',
      '  and a third.',
      'allowed-tools: Read',
      '---',
    ].join('\n');
    expect(parseFrontmatterDescription(content)).toBe(
      'First part of the description continued on the next line and a third.',
    );
  });

  it('handles a YAML block scalar', () => {
    const content = ['---', 'description: |', '  Line one.', '  Line two.', '---'].join('\n');
    expect(parseFrontmatterDescription(content)).toBe('Line one. Line two.');
  });

  it('strips surrounding quotes', () => {
    const content = ['---', 'description: "Quoted value"', '---'].join('\n');
    expect(parseFrontmatterDescription(content)).toBe('Quoted value');
  });

  it('stops at the next top-level key', () => {
    const content = [
      '---',
      'description: Only this.',
      'model: opus',
      '---',
    ].join('\n');
    expect(parseFrontmatterDescription(content)).toBe('Only this.');
  });

  it('returns null with no frontmatter', () => {
    expect(parseFrontmatterDescription('# Just a heading\n\nBody text.')).toBeNull();
  });

  it('returns null when frontmatter has no description key', () => {
    expect(parseFrontmatterDescription('---\nname: x\n---\nbody')).toBeNull();
  });

  it('returns null for an empty description value', () => {
    expect(parseFrontmatterDescription('---\ndescription:\nname: x\n---')).toBeNull();
  });

  it('ignores a description that is not in leading frontmatter', () => {
    expect(parseFrontmatterDescription('# Title\n\ndescription: not frontmatter')).toBeNull();
  });

  it('handles CRLF line endings', () => {
    const content = '---\r\nname: x\r\ndescription: Windows newlines.\r\n---\r\nbody';
    expect(parseFrontmatterDescription(content)).toBe('Windows newlines.');
  });
});

describe('listingTokens', () => {
  it('falls back to the flat estimate when the description is missing', () => {
    expect(listingTokens('some-skill', null)).toBe(SKILL_PROMPT_OVERHEAD_TOKENS);
  });

  it('scales with description length — the whole point of the v2.8 change', () => {
    const terse = listingTokens('a', 'Short.');
    const verbose = listingTokens('a', 'Word '.repeat(200));
    expect(verbose).toBeGreaterThan(terse * 10);
  });

  it('counts the rendered listing line, not just the description', () => {
    // `- name: description` — the name contributes too.
    const shortName = listingTokens('a', 'Same description here.');
    const longName = listingTokens('a-very-long-hyphenated-skill-name', 'Same description here.');
    expect(longName).toBeGreaterThan(shortName);
  });

  it('is deterministic', () => {
    expect(listingTokens('x', 'Stable.')).toBe(listingTokens('x', 'Stable.'));
  });
});

describe('listingTokensFromContent', () => {
  it('measures a real-shaped SKILL.md above the flat estimate', () => {
    const content = [
      '---',
      'name: humanize',
      'description: Rewrites Korean text that reads as machine-translated, covering' +
        ' passive-voice overuse, mechanical parallelism, connector spam, and' +
        ' uniform sentence rhythm, without altering a single fact.',
      '---',
      '',
      '# Body that should not be counted',
      'x'.repeat(5000),
    ].join('\n');
    const tokens = listingTokensFromContent('humanize', content);
    expect(tokens).toBeGreaterThan(SKILL_PROMPT_OVERHEAD_TOKENS);
    // Body must be excluded — 5000 chars would blow well past this.
    expect(tokens).toBeLessThan(200);
  });

  it('falls back for a SKILL.md with no frontmatter', () => {
    expect(listingTokensFromContent('bare', '# Bare skill')).toBe(SKILL_PROMPT_OVERHEAD_TOKENS);
  });
});
