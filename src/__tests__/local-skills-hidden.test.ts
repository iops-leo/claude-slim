import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { scanLocalSkills } from '../scanner/local-skills.js';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';

/**
 * `~/.claude/skills/.trash/<id>/<skill>/SKILL.md` holds deleted skills that
 * Claude Code no longer loads. The walk descended into it anyway, so deleted
 * skills were billed at startup and flagged unused/oversized — 11 skills and
 * 14 findings on the machine where this was found. Dot-directories are skipped
 * at every depth, as the Codex scanner already does.
 */
describe('scanLocalSkills — hidden directories', () => {
  let tmp: TmpClaude;
  beforeAll(async () => { await initTokenizer(); });
  beforeEach(async () => { tmp = await createTmpClaude(); });
  afterEach(async () => { await tmp.cleanup(); });

  async function skill(...parts: string[]): Promise<void> {
    const dir = join(tmp.skillsDir, ...parts);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), `---\nname: ${parts.at(-1)}\ndescription: test skill\n---\nbody\n`);
  }

  it('skips skills under .trash and other dot-directories at any depth', async () => {
    await skill('real');
    await skill('group', 'nested');
    await skill('.trash', '1792061996066-54359-j6pFne', 'mcp-builder');
    await skill('.hidden-top');
    await skill('group', '.old', 'stale');

    const { skills } = await scanLocalSkills();
    expect(skills.map((s) => s.name).sort()).toEqual(['group/nested', 'real']);
  });
});
