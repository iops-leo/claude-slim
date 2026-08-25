import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SKILL_MD = fileURLToPath(new URL('../../skills/claude-slim/SKILL.md', import.meta.url));
const body = readFileSync(SKILL_MD, 'utf8');
const lines = body.split('\n');

/**
 * SKILL.md ships without dist/ when installed via `npx skills add` (skills.sh), where
 * CLAUDE_PLUGIN_ROOT is unset. Every command therefore carries its own resolver — a
 * fresh shell per Bash call means a function cannot be shared between blocks. Nothing
 * else checks that those copies stay in agreement, which is what these tests are for.
 */
describe('SKILL.md CLI resolver', () => {
  const resolverLines = lines.filter((l) => l.includes('claude_slim(){'));

  it('defines a resolver for every command block', () => {
    expect(resolverLines.length).toBeGreaterThanOrEqual(7);
  });

  it('keeps every copy byte-identical', () => {
    expect(new Set(resolverLines).size).toBe(1);
  });

  it('never invokes the CLI through a bare plugin-root path', () => {
    const offenders = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /node "\$\{?CLAUDE_PLUGIN_ROOT\}?\/dist\/cli\.js"/.test(line))
      .filter(({ line }) => !line.includes('claude_slim(){'));
    expect(offenders).toEqual([]);
  });

  it('guards the plugin tier against an unset variable', () => {
    expect(resolverLines[0]).toContain('[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]');
  });

  it('pins the npx tier to the exact release this SKILL.md ships with', () => {
    // Not just the major: npx reuses any cached _npx install satisfying the
    // range and never re-checks the registry, so `@^2` would strand a
    // skills.sh user on whatever 2.x they fetched first. Moving the pin every
    // release changes the cache key and forces a fresh fetch.
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { version: string };
    expect(resolverLines[0]).toContain(`'claude-slim@^${pkg.version}'`);
    expect(resolverLines[0]).not.toContain('claude-slim@latest');
  });
});

describe('SKILL.md bash-scanner fallback', () => {
  it('fails loudly when no candidate directory matches', () => {
    // A silent exit 0 here would hand Phase 2 an empty scan, which reads as a clean
    // environment — the one failure mode worse than reporting nothing.
    expect(body).toContain('no scan.sh found in any known skill directory');
    expect(body).toMatch(/echo "claude-slim: no scan\.sh found[^"]*" >&2\nexit 1/);
  });

  it('requests JSON, which is what Phase 2 consumes', () => {
    expect(body).toContain('bash "$d/scripts/scan.sh" json');
  });
});
