import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { scanLocalSkills } from '../scanner/local-skills.js';
import { createTmpClaude, writeSkill, type TmpClaude } from './helpers/tmp-claude.js';

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
});

afterEach(async () => {
  await tmp.cleanup();
});

describe('scanLocalSkills — bounded recursive walk', () => {
  it('discovers a top-level skill at depth 1', async () => {
    await writeSkill(tmp.skillsDir, 'foo', 'top');
    const result = await scanLocalSkills();
    const names = result.skills.map((s) => s.name).sort();
    expect(names).toEqual(['foo']);
  });

  it('discovers a nested skill at depth 2 (org/skill)', async () => {
    await writeSkill(tmp.skillsDir, 'gstack/ship', 'nested d2');
    const result = await scanLocalSkills();
    const names = result.skills.map((s) => s.name).sort();
    expect(names).toEqual(['gstack/ship']);
  });

  it('discovers a nested skill at depth 3 (org/group/skill)', async () => {
    // Regression: prior 2-level unroll silently missed depth-3 layouts,
    // so token totals under-reported and unused_skill could never flag them.
    await writeSkill(tmp.skillsDir, 'org/group/deep', 'nested d3');
    const result = await scanLocalSkills();
    const names = result.skills.map((s) => s.name).sort();
    expect(names).toEqual(['org/group/deep']);
  });

  it('stops descending once a SKILL.md is found (no phantom child)', async () => {
    // A skill at depth 1 with a nested sub-directory that also contains a
    // SKILL.md must NOT be surfaced as a second skill — the nested files are
    // examples/docs, not independently addressable skills.
    await writeSkill(tmp.skillsDir, 'parent', 'parent skill');
    await writeSkill(join(tmp.skillsDir, 'parent'), 'child', 'nested doc');
    const result = await scanLocalSkills();
    const names = result.skills.map((s) => s.name).sort();
    expect(names).toEqual(['parent']);
  });

  it('mixes depths in a single scan', async () => {
    await writeSkill(tmp.skillsDir, 'flat', 'd1');
    await writeSkill(tmp.skillsDir, 'ns/mid', 'd2');
    await writeSkill(tmp.skillsDir, 'ns/sub/deep', 'd3');
    const result = await scanLocalSkills();
    const names = result.skills.map((s) => s.name).sort();
    expect(names).toEqual(['flat', 'ns/mid', 'ns/sub/deep']);
  });

  it('does not descend past MAX_SKILL_DEPTH (depth 4 is invisible)', async () => {
    // Guards against unbounded growth if someone drops SKILL.md at extreme depth.
    await writeSkill(tmp.skillsDir, 'a/b/c/way-too-deep', 'ignored');
    const result = await scanLocalSkills();
    expect(result.skills.map((s) => s.name)).toEqual([]);
  });
});
