import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { scan } from '../scanner/index.js';
import { parseFrontmatterPaths, scanUserRules } from '../scanner/rules.js';
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

async function writeRule(rel: string, content: string): Promise<string> {
  const p = join(tmp.claudeDir, 'rules', rel);
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, content);
  return p;
}

describe('parseFrontmatterPaths', () => {
  it('returns null without frontmatter', () => {
    expect(parseFrontmatterPaths('# Rule\nbody')).toBeNull();
  });

  it('reads a YAML list', () => {
    const fm = '---\npaths:\n  - "**/*.ts"\n  - \'**/*.tsx\'\n---\nbody';
    expect(parseFrontmatterPaths(fm)).toEqual(['**/*.ts', '**/*.tsx']);
  });

  it('reads an inline flow list', () => {
    const fm = '---\npaths: ["src/**", "lib/**"]\n---\nbody';
    expect(parseFrontmatterPaths(fm)).toEqual(['src/**', 'lib/**']);
  });

  it('reads a single scalar', () => {
    expect(parseFrontmatterPaths('---\npaths: src/**\n---\n')).toEqual(['src/**']);
  });

  it('returns null when frontmatter has no paths key', () => {
    expect(parseFrontmatterPaths('---\ndescription: x\n---\n')).toBeNull();
  });

  it('reads a zero-indent block list', () => {
    const fm = '---\npaths:\n- "src/api/**/*.ts"\n- lib/**\n---\n';
    expect(parseFrontmatterPaths(fm)).toEqual(['src/api/**/*.ts', 'lib/**']);
  });

  it('skips comments and blank lines inside a block list, stops at the next key', () => {
    const fm = '---\npaths:\n  # only ts\n\n  - "**/*.ts"  # trailing\n  - "**/*.tsx"\ndescription: x\n---\n';
    expect(parseFrontmatterPaths(fm)).toEqual(['**/*.ts', '**/*.tsx']);
  });

  it('keeps a brace glob whole inside a flow list', () => {
    const fm = '---\npaths: ["src/**/*.{ts,tsx}", "lib/**/*.ts"]\n---\n';
    expect(parseFrontmatterPaths(fm)).toEqual(['src/**/*.{ts,tsx}', 'lib/**/*.ts']);
  });

  it('drops a trailing comment from a scalar', () => {
    expect(parseFrontmatterPaths('---\npaths: "src/**"  # only src\n---\n')).toEqual(['src/**']);
  });
});

describe('scanUserRules', () => {
  it('walks nested directories and marks path-scoped rules conditional', async () => {
    await writeRule('common/style.md', '# Style\nAlways use tabs.\n');
    await writeRule('typescript/ts.md', '---\npaths:\n  - "**/*.ts"\n---\n# TS\nStrict mode.\n');

    const rules = await scanUserRules();
    const names = rules.map((r) => r.name).sort();
    expect(names).toEqual(['common/style.md', 'typescript/ts.md']);

    const common = rules.find((r) => r.name === 'common/style.md')!;
    const ts = rules.find((r) => r.name === 'typescript/ts.md')!;
    expect(common.conditional).toBe(false);
    expect(common.paths).toEqual([]);
    expect(ts.conditional).toBe(true);
    expect(ts.paths).toEqual(['**/*.ts']);
    expect(common.tokens).toBeGreaterThan(0);
  });

  it('ignores non-markdown files', async () => {
    await writeRule('notes.txt', 'not a rule');
    expect(await scanUserRules()).toHaveLength(0);
  });

  it('returns empty when the directory does not exist', async () => {
    expect(await scanUserRules()).toEqual([]);
  });

  it('does not re-emit a rule through a symlink loop', async () => {
    const { symlink } = await import('node:fs/promises');
    await writeRule('common/a.md', '# A\nbody');
    await symlink(join(tmp.claudeDir, 'rules'), join(tmp.claudeDir, 'rules', 'common', 'loop'));

    const rules = await scanUserRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe('common/a.md');
  });
});

describe('rules in the startup estimate', () => {
  it('adds unconditional rules and excludes path-scoped ones', async () => {
    await writeRule('common/a.md', '# A\n' + 'always loaded. '.repeat(50));
    await writeRule('ts/b.md', '---\npaths: ["**/*.ts"]\n---\n# B\n' + 'only for ts. '.repeat(50));

    vi.spyOn(process, 'cwd').mockReturnValue('/Users/me/active');
    const result = await scan();

    expect(result.userRules).toHaveLength(2);
    const a = result.userRules.find((r) => r.name === 'common/a.md')!;
    const b = result.userRules.find((r) => r.name === 'ts/b.md')!;
    expect(result.rulesStartupTokens).toBe(a.tokens);
    expect(result.rulesConditionalTokens).toBe(b.tokens);
    expect(result.totalTokensBefore).toBeGreaterThanOrEqual(a.tokens);
    expect(result.totalTokensBefore).toBeLessThan(a.tokens + b.tokens);
  });

  it('counts a rule CLAUDE.md also @imports only once', async () => {
    const rulePath = await writeRule('common/shared.md', '# Shared\n' + 'guidance. '.repeat(80));
    await writeFile(join(tmp.claudeDir, 'CLAUDE.md'), '# Root\n@rules/common/shared.md\n');

    vi.spyOn(process, 'cwd').mockReturnValue('/Users/me/active');
    const result = await scan();

    expect(result.claudeMdImports.map((i) => i.path)).toEqual([rulePath]);
    expect(result.rulesStartupTokens).toBe(0);
    expect(result.totalTokensBefore).toBe(
      result.claudeMdTokens + result.claudeMdImportTokens,
    );
  });
});
