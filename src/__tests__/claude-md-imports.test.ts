import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { scan } from '../scanner/index.js';
import { extractImportSpecs, resolveClaudeMdImports } from '../scanner/claude-md-imports.js';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';

vi.mock('../scanner/fs-walk.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scanner/fs-walk.js')>()),
  runCommand: async () => '',
}));

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
  await initTokenizer();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await tmp.cleanup();
});

describe('extractImportSpecs', () => {
  it('finds a line-level import', () => {
    expect(extractImportSpecs('# Title\n\n@RTK.md\n')).toEqual(['RTK.md']);
  });

  it('finds inline imports and strips trailing punctuation', () => {
    const md = 'See @README for overview and @docs/git.md, then @~/.claude/x.md.';
    expect(extractImportSpecs(md)).toEqual(['README', 'docs/git.md', '~/.claude/x.md']);
  });

  it('skips fenced code blocks and inline code', () => {
    const md = '```\n@in-fence.md\n```\nuse `@in-code.md` here\n@real.md';
    expect(extractImportSpecs(md)).toEqual(['real.md']);
  });

  it('does not treat emails as imports', () => {
    expect(extractImportSpecs('mail me at leo@example.com')).toEqual([]);
  });

  it('closes a fence only on a matching run of the same character', () => {
    const tilde = '~~~\n@inside.md\n```\n@still-inside.md\n~~~\n@after.md';
    expect(extractImportSpecs(tilde)).toEqual(['after.md']);
    const four = '````\n```\n@inside.md\n```\n````\n@after.md';
    expect(extractImportSpecs(four)).toEqual(['after.md']);
  });

  it('ignores HTML comments', () => {
    expect(extractImportSpecs('<!-- @commented.md -->\n@real.md')).toEqual(['real.md']);
  });
});

describe('resolveClaudeMdImports', () => {
  it('resolves relative to the importing file, recursively, up to four hops', async () => {
    const root = join(tmp.claudeDir, 'CLAUDE.md');
    await mkdir(join(tmp.claudeDir, 'sub'), { recursive: true });
    await writeFile(root, '# Root\n@a.md\n');
    await writeFile(join(tmp.claudeDir, 'a.md'), 'A body\n@sub/b.md\n');
    await writeFile(join(tmp.claudeDir, 'sub', 'b.md'), 'B body\n@c.md\n');
    await writeFile(join(tmp.claudeDir, 'sub', 'c.md'), 'C body\n@d.md\n');
    await writeFile(join(tmp.claudeDir, 'sub', 'd.md'), 'D body\n@e.md\n');
    await writeFile(join(tmp.claudeDir, 'sub', 'e.md'), 'E body — five hops, must not load\n');

    const imports = await resolveClaudeMdImports(root, '# Root\n@a.md\n');
    const specs = imports.map((i) => i.spec);
    expect(specs).toEqual(['a.md', 'sub/b.md', 'c.md', 'd.md']);
    expect(imports.map((i) => i.depth)).toEqual([1, 2, 3, 4]);
    expect(imports.every((i) => i.tokens > 0)).toBe(true);
  });

  it('drops missing targets silently — @mentions in prose are not imports', async () => {
    const root = join(tmp.claudeDir, 'CLAUDE.md');
    await writeFile(root, 'ping @claude and @anthropic-ai/sdk\n');
    expect(await resolveClaudeMdImports(root, 'ping @claude and @anthropic-ai/sdk\n')).toEqual([]);
  });

  it('expands ~ to the home directory', async () => {
    const root = join(tmp.claudeDir, 'CLAUDE.md');
    await writeFile(join(tmp.home, 'shared.md'), 'shared body');
    const imports = await resolveClaudeMdImports(root, '@~/shared.md\n');
    expect(imports).toHaveLength(1);
    expect(imports[0].path).toBe(join(tmp.home, 'shared.md'));
  });

  it('skips a target too large to be instructions', async () => {
    const root = join(tmp.claudeDir, 'CLAUDE.md');
    await writeFile(join(tmp.claudeDir, 'huge.log'), 'x'.repeat(2 * 1024 * 1024));
    expect(await resolveClaudeMdImports(root, '@huge.log\n')).toEqual([]);
  });

  it('counts a symlink and its target as one file', async () => {
    const { symlink } = await import('node:fs/promises');
    const root = join(tmp.claudeDir, 'CLAUDE.md');
    await writeFile(join(tmp.claudeDir, 'target.md'), 'shared body');
    await symlink(join(tmp.claudeDir, 'target.md'), join(tmp.claudeDir, 'link.md'));
    const imports = await resolveClaudeMdImports(root, '@link.md\n@target.md\n');
    expect(imports).toHaveLength(1);
  });

  it('survives an import cycle', async () => {
    const root = join(tmp.claudeDir, 'CLAUDE.md');
    await writeFile(root, '@loop.md\n');
    await writeFile(join(tmp.claudeDir, 'loop.md'), '@CLAUDE.md\n@loop.md\n');
    const imports = await resolveClaudeMdImports(root, '@loop.md\n');
    expect(imports.map((i) => i.spec)).toEqual(['loop.md']);
  });
});

describe('imports in the startup estimate', () => {
  it('adds imported file tokens to totalTokensBefore', async () => {
    await writeFile(join(tmp.claudeDir, 'CLAUDE.md'), '# Root\n@extra.md\n');
    await writeFile(join(tmp.claudeDir, 'extra.md'), 'imported guidance. '.repeat(100));

    vi.spyOn(process, 'cwd').mockReturnValue('/Users/me/active');
    const result = await scan();

    expect(result.claudeMdImports).toHaveLength(1);
    expect(result.claudeMdImportTokens).toBe(result.claudeMdImports[0].tokens);
    expect(result.totalTokensBefore).toBeGreaterThanOrEqual(
      result.claudeMdTokens + result.claudeMdImportTokens,
    );
  });
});
