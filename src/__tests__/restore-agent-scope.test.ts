import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { cleanIssues, restoreItem } from '../cleaner.js';
import { readManifest } from '../manifest.js';
import type { ManifestEntry } from '../types.js';
import { createTmpClaude, writeSkill, exists, type TmpClaude } from './helpers/tmp-claude.js';

/**
 * A Claude skill and a Codex skill can share a name. Restoring the Codex one
 * removed the first manifest entry with that name — the Claude one — leaving
 * the Claude backup parked with no record to restore it from.
 */

let tmp: TmpClaude;
beforeEach(async () => { tmp = await createTmpClaude(); });
afterEach(async () => { await tmp.cleanup(); });

describe('restore removes only its own manifest entry', () => {
  it('restoring Codex foo keeps Claude foo restorable', async () => {
    const claudeFoo = await writeSkill(tmp.skillsDir, 'foo', 'claude foo');
    const codexFoo = await writeSkill(join(tmp.home, '.codex', 'skills'), 'foo', 'codex foo');
    const r = await cleanIssues([
      { type: 'unused_skill', tier: 3, name: 'foo', tokens: 5, path: claudeFoo },
      { type: 'template', tier: 1, name: 'foo', tokens: 5, path: codexFoo, agent: 'codex' },
    ]);
    expect(r.errors).toEqual([]);

    const before = (await readManifest()) as ManifestEntry[];
    await restoreItem(before.find((e) => e.agent === 'codex')!);

    const after = (await readManifest()) as ManifestEntry[];
    expect(after.map((e) => `${e.agent}:${e.from}`)).toEqual([`claude:${claudeFoo}`]);
    await restoreItem(after[0]);
    expect(await exists(join(claudeFoo, 'SKILL.md'))).toBe(true);
    expect(await exists(join(codexFoo, 'SKILL.md'))).toBe(true);
    expect(await readManifest()).toEqual([]);
  });
});
