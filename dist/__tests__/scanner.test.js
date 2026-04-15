import { describe, it, expect, beforeAll } from 'vitest';
import { initTokenizer } from '../tokenizer.js';
import { parseClaudeMdSections } from '../scanner.js';
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
