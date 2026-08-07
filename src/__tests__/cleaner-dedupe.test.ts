import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { cleanIssues } from '../cleaner.js';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, exists, type TmpClaude } from './helpers/tmp-claude.js';
import type { Issue } from '../types.js';

/**
 * Regression guard for a cleanup that worked but reported failure.
 *
 * Detectors are independent, so one skill collects several findings —
 * `skillify` was flagged duplicate + oversized_skill + unused_skill at once.
 * Choosing "all" then renamed the same directory three times: the first call
 * succeeded, the other two raised ENOENT, and the user was shown raw error rows
 * for work that had actually completed. On the machine where this was found,
 * 40 distinct paths carried 55 findings — 15 spurious errors.
 */

let tmp: TmpClaude;

beforeAll(async () => { await initTokenizer(); });
beforeEach(async () => { tmp = await createTmpClaude(); });
afterEach(async () => { await tmp.cleanup(); });

async function makeSkill(skillsDir: string, name: string): Promise<string> {
  const dir = join(skillsDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), 'body '.repeat(500));
  return dir;
}

const at = (type: Issue['type'], name: string, path: string): Issue =>
  ({ type, tier: 3, name, tokens: 5000, path });

describe('cleanIssues — several findings on one path', () => {
  it('acts once and reports no error', async () => {
    const dir = await makeSkill(tmp.skillsDir, 'skillify');

    const result = await cleanIssues([
      at('duplicate', 'skillify', dir),
      at('oversized_skill', 'skillify', dir),
      at('unused_skill', 'skillify', dir),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.moved).toHaveLength(1);
    expect(result.moved[0].type).toBe('duplicate'); // first wins
    expect(await exists(dir)).toBe(false);
    expect(await exists(join(tmp.disabledDir, 'skillify'))).toBe(true);
  });

  it('still processes distinct paths independently', async () => {
    const a = await makeSkill(tmp.skillsDir, 'alpha');
    const b = await makeSkill(tmp.skillsDir, 'beta');

    const result = await cleanIssues([
      at('oversized_skill', 'alpha', a),
      at('unused_skill', 'alpha', a),
      at('unused_skill', 'beta', b),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.moved.map((m) => m.name).sort()).toEqual(['alpha', 'beta']);
    expect(await exists(join(tmp.disabledDir, 'alpha'))).toBe(true);
    expect(await exists(join(tmp.disabledDir, 'beta'))).toBe(true);
  });

  it('writes one manifest entry per path, keeping restore unambiguous', async () => {
    const dir = await makeSkill(tmp.skillsDir, 'gamma');
    const result = await cleanIssues([
      at('oversized_skill', 'gamma', dir),
      at('unused_skill', 'gamma', dir),
    ]);
    expect(result.moved.filter((m) => m.name === 'gamma')).toHaveLength(1);
  });

  it('does not collapse same-named issues that live at different paths', async () => {
    const local = await makeSkill(tmp.skillsDir, 'shared');
    const nested = await makeSkill(join(tmp.skillsDir, 'nested'), 'shared');

    const result = await cleanIssues([
      at('duplicate', 'shared', local),
      at('duplicate', 'nested/shared', nested),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.moved).toHaveLength(2);
  });
});
