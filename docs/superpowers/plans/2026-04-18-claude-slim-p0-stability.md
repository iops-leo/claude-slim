# claude-slim P0 Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v2.2 stability release by (1) adding round-trip tests for the `clean`/`restore` pipeline, (2) bounding manifest growth via schema v2, and (3) eliminating partial-failure risk in stale-project restore.

**Architecture:** Extract path resolution into a dedicated module so tests can override `HOME` via a tmp `~/.claude`. Add round-trip tests per issue type using `tmp-promise`. Replace the append-only JSONL manifest with a single JSON file containing only currently-disabled entries (active removal on restore). Replace file-by-file moves in stale-project clean/restore with atomic directory renames.

**Tech Stack:** TypeScript 5.7, Node 18+, vitest 4.1, tmp-promise (new devDep), existing `js-tiktoken` / `commander`.

**Scope reference:** `docs/superpowers/specs/2026-04-18-improvement-backlog-design.md` — P0 items #1, #2, #3.

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `src/paths.ts` | Function-based resolution of all `~/.claude/...` paths, honors `HOME` env |
| `src/__tests__/helpers/tmp-claude.ts` | Vitest helper that builds a tmp `~/.claude` tree + stubs `HOME` |
| `src/__tests__/paths.test.ts` | Verifies paths honor HOME stub |
| `src/__tests__/cleaner.test.ts` | Round-trip tests for every issue type |
| `src/__tests__/manifest.test.ts` | v1→v2 migration + add/remove entry tests |

### Modified files
| Path | Reason |
|---|---|
| `src/scanner.ts` | Replace module-level path consts with `paths.ts` getters |
| `src/cleaner.ts` | Use `paths.ts`; replace stale-project file-loop with atomic dir rename; use new manifest API |
| `src/manifest.ts` | Replace JSONL append-only with JSON `{version:2, entries:[]}` + migration |
| `src/cli.ts` | Update restore flow to use new manifest removal API |
| `src/types.ts` | Add `Manifest` interface |
| `package.json` | Add `tmp-promise` devDep |

### Deliberately unchanged
- `src/tokenizer.ts` — cache paths use `homedir()` directly; P2 concern, out of scope
- `src/report.ts` `HOME_PREFIX` — display-only, only used in `formatScanSummary` not exercised by tests

---

## Task 1: Extract path resolution into `src/paths.ts`

**Files:**
- Create: `src/paths.ts`
- Create: `src/__tests__/paths.test.ts`
- Modify: `src/scanner.ts:9-13` (path consts)
- Modify: `src/cleaner.ts:7` (SKILLS_DIR const)
- Modify: `src/manifest.ts:6-7` (DISABLED_DIR, MANIFEST_PATH)

**Rationale:** Node's `os.homedir()` reads `HOME` env each call (no caching). If we move path consts into functions that call `homedir()` on each invocation, tests can stub `HOME` with `vi.stubEnv` before calling any scanner/cleaner code.

- [ ] **Step 1: Write failing test for paths module**

Create `src/__tests__/paths.test.ts`:

```typescript
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getClaudeDir,
  getSkillsDir,
  getPluginsDir,
  getProjectsDir,
  getDisabledDir,
  getManifestPath,
} from '../paths.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('paths', () => {
  it('resolves ~/.claude from HOME env', () => {
    vi.stubEnv('HOME', '/tmp/fake-home');
    expect(getClaudeDir()).toBe('/tmp/fake-home/.claude');
  });

  it('resolves skills dir under claude dir', () => {
    vi.stubEnv('HOME', '/tmp/fake-home');
    expect(getSkillsDir()).toBe('/tmp/fake-home/.claude/skills');
  });

  it('resolves plugins cache dir', () => {
    vi.stubEnv('HOME', '/tmp/fake-home');
    expect(getPluginsDir()).toBe('/tmp/fake-home/.claude/plugins/cache');
  });

  it('resolves projects dir', () => {
    vi.stubEnv('HOME', '/tmp/fake-home');
    expect(getProjectsDir()).toBe('/tmp/fake-home/.claude/projects');
  });

  it('resolves disabled dir', () => {
    vi.stubEnv('HOME', '/tmp/fake-home');
    expect(getDisabledDir()).toBe('/tmp/fake-home/.claude/skills.disabled');
  });

  it('resolves manifest path under disabled dir', () => {
    vi.stubEnv('HOME', '/tmp/fake-home');
    expect(getManifestPath()).toBe('/tmp/fake-home/.claude/skills.disabled/manifest.json');
  });

  it('re-reads HOME on each call (not cached)', () => {
    vi.stubEnv('HOME', '/tmp/home-a');
    expect(getClaudeDir()).toBe('/tmp/home-a/.claude');
    vi.stubEnv('HOME', '/tmp/home-b');
    expect(getClaudeDir()).toBe('/tmp/home-b/.claude');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/paths.test.ts`
Expected: FAIL with `Cannot find module '../paths.js'`

- [ ] **Step 3: Create `src/paths.ts`**

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';

export function getClaudeDir(): string {
  return join(homedir(), '.claude');
}

export function getSkillsDir(): string {
  return join(getClaudeDir(), 'skills');
}

export function getPluginsDir(): string {
  return join(getClaudeDir(), 'plugins', 'cache');
}

export function getProjectsDir(): string {
  return join(getClaudeDir(), 'projects');
}

export function getDisabledDir(): string {
  return join(getClaudeDir(), 'skills.disabled');
}

export function getManifestPath(): string {
  return join(getDisabledDir(), 'manifest.json');
}

export function getLegacyManifestPath(): string {
  return join(getDisabledDir(), '.claude-slim-manifest.jsonl');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/paths.test.ts`
Expected: PASS, 7 tests pass.

- [ ] **Step 5: Refactor `src/scanner.ts` to use paths.ts**

Replace lines 1-13 with:

```typescript
import { readdir, readFile, readlink, stat, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { countTokensCached } from './tokenizer.js';
import { getClaudeDir, getSkillsDir, getPluginsDir, getProjectsDir } from './paths.js';
import type {
  ScanResult, SkillInfo, BrokenSymlink, MemoryFile, PluginInfo, Issue,
} from './types.js';

const STALE_DAYS = 90;
```

Then within `scanLocalSkills`, replace `SKILLS_DIR` with `getSkillsDir()`:
- Line 105: `const entries = await safeReaddir(getSkillsDir());`
- Line 108: `const dirPath = join(getSkillsDir(), entry);`

Within `scanPluginSkills`:
- Line 188: `const pluginDirs = await safeReaddir(getPluginsDir());`
- Line 191: `const pluginDir = join(getPluginsDir(), pluginName);`
- Line 518: `path: join(getPluginsDir(), plugin.name),`

Within `scanMemoryFiles`:
- Line 261: `const projectDirs = await safeReaddir(getProjectsDir());`
- Line 265: `const memDir = join(getProjectsDir(), project, 'memory');`

Within `scanMcpServers`:
- Line 376: `const content = await safeReadFile(join(getClaudeDir(), 'settings.json'));`

Within `scan()`:
- Line 549-552: replace `CLAUDE_DIR` usage with `getClaudeDir()`

- [ ] **Step 6: Refactor `src/cleaner.ts` to use paths.ts**

Replace lines 1-7 with:

```typescript
import { rename, readdir, rmdir, rm, unlink, lstat, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { appendManifest, ensureDisabledDir, getDisabledDir } from './manifest.js';
import { getSkillsDir } from './paths.js';
import type { Issue, ManifestEntry } from './types.js';
```

Line 99: replace `SKILLS_DIR` with `getSkillsDir()`.

- [ ] **Step 7: Refactor `src/manifest.ts` to use paths.ts**

Replace the entire file with:

```typescript
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { ManifestEntry } from './types.js';
import { getDisabledDir as getDir, getManifestPath, getLegacyManifestPath } from './paths.js';

export function getDisabledDir(): string {
  return getDir();
}

export async function ensureDisabledDir(): Promise<void> {
  await mkdir(getDisabledDir(), { recursive: true });
}

export async function readManifest(): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  let content: string;
  try {
    content = await readFile(getLegacyManifestPath(), 'utf-8');
  } catch {
    return entries;
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // Skip corrupted lines
    }
  }

  return entries;
}

export async function appendManifest(entry: ManifestEntry): Promise<void> {
  await ensureDisabledDir();
  const { appendFile } = await import('node:fs/promises');
  await appendFile(getLegacyManifestPath(), JSON.stringify(entry) + '\n');
}
```

(We keep legacy JSONL behavior for now — Task 7 replaces this with v2 schema.)

- [ ] **Step 8: Run all tests to verify no regression**

Run: `npm test`
Expected: All existing tests pass (scanner: 14 tests, selection: 15, report: 5, paths: 7) = 41 pass.

- [ ] **Step 9: Build to verify no TypeScript errors**

Run: `npm run build`
Expected: Clean build, `dist/` populated.

- [ ] **Step 10: Commit**

```bash
git add src/paths.ts src/__tests__/paths.test.ts src/scanner.ts src/cleaner.ts src/manifest.ts
git commit -m "refactor: extract path resolution into paths.ts"
```

---

## Task 2: Test harness + broken_symlink round-trip

**Files:**
- Modify: `package.json` (add `tmp-promise`)
- Create: `src/__tests__/helpers/tmp-claude.ts`
- Create: `src/__tests__/cleaner.test.ts`

**Rationale:** Round-trip tests need a throwaway `~/.claude` tree. `tmp-promise` wraps `mkdtemp` with automatic cleanup. The helper centralizes setup so each test is 10 lines, not 50.

- [ ] **Step 1: Install tmp-promise**

Run:
```bash
npm install --save-dev tmp-promise
```
Expected: `package.json` updated, lockfile updated, no build errors.

- [ ] **Step 2: Create test helper**

Create `src/__tests__/helpers/tmp-claude.ts`:

```typescript
import { dir } from 'tmp-promise';
import { join } from 'node:path';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { vi } from 'vitest';

export interface TmpClaude {
  home: string;
  claudeDir: string;
  skillsDir: string;
  pluginsDir: string;
  projectsDir: string;
  disabledDir: string;
  cleanup: () => Promise<void>;
}

export async function createTmpClaude(): Promise<TmpClaude> {
  const d = await dir({ unsafeCleanup: true });
  const home = d.path;
  const claudeDir = join(home, '.claude');
  const skillsDir = join(claudeDir, 'skills');
  const pluginsDir = join(claudeDir, 'plugins', 'cache');
  const projectsDir = join(claudeDir, 'projects');
  const disabledDir = join(claudeDir, 'skills.disabled');

  await mkdir(skillsDir, { recursive: true });
  await mkdir(pluginsDir, { recursive: true });
  await mkdir(projectsDir, { recursive: true });

  vi.stubEnv('HOME', home);

  return {
    home,
    claudeDir,
    skillsDir,
    pluginsDir,
    projectsDir,
    disabledDir,
    cleanup: async () => {
      vi.unstubAllEnvs();
      await d.cleanup();
    },
  };
}

export async function writeSkill(
  skillsDir: string,
  name: string,
  content: string,
): Promise<string> {
  const skillDir = join(skillsDir, name);
  await mkdir(skillDir, { recursive: true });
  const mdPath = join(skillDir, 'SKILL.md');
  await writeFile(mdPath, content);
  return skillDir;
}

export async function writeBrokenSymlink(
  skillsDir: string,
  name: string,
): Promise<string> {
  const skillDir = join(skillsDir, name);
  await mkdir(skillDir, { recursive: true });
  const mdPath = join(skillDir, 'SKILL.md');
  await symlink('/nonexistent/target', mdPath);
  return mdPath;
}
```

- [ ] **Step 3: Write failing round-trip test for broken_symlink**

Create `src/__tests__/cleaner.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { access } from 'node:fs/promises';
import { cleanIssues } from '../cleaner.js';
import { readManifest } from '../manifest.js';
import { createTmpClaude, writeBrokenSymlink, type TmpClaude } from './helpers/tmp-claude.js';
import type { Issue } from '../types.js';

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
});

afterEach(async () => {
  await tmp.cleanup();
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('cleanIssues — broken_symlink', () => {
  it('unlinks broken symlink and records manifest entry', async () => {
    const mdPath = await writeBrokenSymlink(tmp.skillsDir, 'dead-skill');
    const issue: Issue = {
      type: 'broken_symlink',
      tier: 1,
      name: 'dead-skill',
      tokens: 0,
      path: mdPath,
    };

    const result = await cleanIssues([issue]);

    expect(result.moved).toHaveLength(1);
    expect(result.moved[0].name).toBe('dead-skill');
    expect(result.moved[0].type).toBe('broken_symlink');
    expect(result.errors).toHaveLength(0);
    expect(await exists(mdPath)).toBe(false);

    // Manifest recorded — read via API so test survives v1→v2 migration
    const entries = await readManifest();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('dead-skill');
    expect(entries[0].type).toBe('broken_symlink');
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/cleaner.test.ts`
Expected: PASS. 1 test.

(No implementation change needed — Task 1 refactor enables the test.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/__tests__/helpers/ src/__tests__/cleaner.test.ts
git commit -m "test: add cleaner round-trip harness and broken_symlink case"
```

---

## Task 3: Round-trip tests — skill-dir issue types

**Files:**
- Modify: `src/__tests__/cleaner.test.ts`
- Modify: `src/__tests__/helpers/tmp-claude.ts` (add fixtures for each type)

Covers `template`, `duplicate`, `skill_dup`, `oversized_skill` — all use the same `rename(issue.path → disabled/safeName)` code path.

- [ ] **Step 1: Write failing round-trip test for each type**

Update the top of `src/__tests__/cleaner.test.ts` to add `restoreItem`, `writeSkill`, and `join` imports (merge with existing imports, don't duplicate):

```typescript
import { join } from 'node:path';
import { cleanIssues, restoreItem } from '../cleaner.js';
import { createTmpClaude, writeBrokenSymlink, writeSkill, type TmpClaude } from './helpers/tmp-claude.js';
```

Append to the file:

```typescript
describe('cleanIssues — skill directory moves', () => {
  const skillTypes: Array<'template' | 'duplicate' | 'skill_dup' | 'oversized_skill'> = [
    'template',
    'duplicate',
    'skill_dup',
    'oversized_skill',
  ];

  for (const type of skillTypes) {
    it(`moves ${type} skill to disabled dir and restores it`, async () => {
      const skillPath = await writeSkill(tmp.skillsDir, 'my-skill', 'content here');
      const issue: Issue = {
        type,
        tier: type === 'oversized_skill' ? 3 : type === 'duplicate' ? 2 : 1,
        name: 'my-skill',
        tokens: 100,
        path: skillPath,
      };

      const cleanResult = await cleanIssues([issue]);

      expect(cleanResult.moved).toHaveLength(1);
      expect(cleanResult.errors).toHaveLength(0);
      expect(await exists(skillPath)).toBe(false);
      expect(await exists(join(tmp.disabledDir, 'my-skill'))).toBe(true);

      // Round-trip restore
      const entries = await readManifest();
      const entry = entries.find((e) => e.name === 'my-skill' && e.action !== 'restored');
      expect(entry).toBeDefined();

      await restoreItem(entry!);

      expect(await exists(skillPath)).toBe(true);
      expect(await exists(join(skillPath, 'SKILL.md'))).toBe(true);
      expect(await exists(join(tmp.disabledDir, 'my-skill'))).toBe(false);
    });
  }

  it('preserves nested skill names with slash replacement', async () => {
    const skillPath = await writeSkill(tmp.skillsDir, 'gstack/ship', 'nested skill');
    const issue: Issue = {
      type: 'duplicate',
      tier: 2,
      name: 'gstack/ship',
      tokens: 100,
      path: skillPath,
    };

    await cleanIssues([issue]);

    // Disabled dir uses -- separator (cleaner.ts:44)
    expect(await exists(join(tmp.disabledDir, 'gstack--ship'))).toBe(true);

    const entries = await readManifest();
    const entry = entries.find((e) => e.name === 'gstack/ship');
    await restoreItem(entry!);

    expect(await exists(skillPath)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/__tests__/cleaner.test.ts`
Expected: PASS. 6 tests total (1 from Task 2 + 5 new = broken_symlink + 4 skill types + nested).

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/cleaner.test.ts
git commit -m "test: add round-trip tests for skill-dir issue types"
```

---

## Task 4: Round-trip test — temp_cache

**Files:**
- Modify: `src/__tests__/cleaner.test.ts`
- Modify: `src/__tests__/helpers/tmp-claude.ts` (add temp cache fixture)

`temp_cache` is the only destructive operation — `rm -rf`. Restore must throw.

- [ ] **Step 1: Add helper for temp cache fixture**

Append to `src/__tests__/helpers/tmp-claude.ts`:

```typescript
export async function writeTempCache(
  pluginsDir: string,
  name: string,
): Promise<string> {
  const cacheDir = join(pluginsDir, name);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(cacheDir, 'junk.txt'), 'failed install remnant');
  return cacheDir;
}
```

- [ ] **Step 2: Write failing test for temp_cache**

Append to `src/__tests__/cleaner.test.ts`:

```typescript
import { writeTempCache } from './helpers/tmp-claude.js';

describe('cleanIssues — temp_cache', () => {
  it('deletes temp cache directory and records manifest', async () => {
    const cachePath = await writeTempCache(tmp.pluginsDir, 'temp_local_abc123');
    const issue: Issue = {
      type: 'temp_cache',
      tier: 1,
      name: 'temp_local_abc123',
      detail: '12KB',
      tokens: 0,
      path: cachePath,
    };

    const result = await cleanIssues([issue]);

    expect(result.moved).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(await exists(cachePath)).toBe(false);
  });

  it('restore throws for temp_cache (not recoverable)', async () => {
    const cachePath = await writeTempCache(tmp.pluginsDir, 'temp_local_xyz');
    const issue: Issue = {
      type: 'temp_cache',
      tier: 1,
      name: 'temp_local_xyz',
      tokens: 0,
      path: cachePath,
    };
    await cleanIssues([issue]);

    const entries = await readManifest();
    const entry = entries.find((e) => e.name === 'temp_local_xyz');
    expect(entry).toBeDefined();

    await expect(restoreItem(entry!)).rejects.toThrow(/temp cache/i);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run src/__tests__/cleaner.test.ts`
Expected: PASS. 8 tests total.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/helpers/tmp-claude.ts src/__tests__/cleaner.test.ts
git commit -m "test: add round-trip tests for temp_cache"
```

---

## Task 5: Round-trip test — stale_project (current impl)

**Files:**
- Modify: `src/__tests__/cleaner.test.ts`
- Modify: `src/__tests__/helpers/tmp-claude.ts` (add stale project fixture)

Tests the existing (non-atomic) implementation. Establishes the baseline before Task 6 makes it atomic.

- [ ] **Step 1: Add helper for stale project fixture**

Append to `src/__tests__/helpers/tmp-claude.ts`:

```typescript
export async function writeStaleProject(
  projectsDir: string,
  projectName: string,
  memoryFiles: Record<string, string>,
): Promise<string> {
  const memDir = join(projectsDir, projectName, 'memory');
  await mkdir(memDir, { recursive: true });
  for (const [name, content] of Object.entries(memoryFiles)) {
    await writeFile(join(memDir, name), content);
  }
  return memDir;
}
```

- [ ] **Step 2: Write failing round-trip test**

Append to `src/__tests__/cleaner.test.ts`:

```typescript
import { writeStaleProject } from './helpers/tmp-claude.js';

describe('cleanIssues — stale_project', () => {
  it('moves memory files to backup and restores them', async () => {
    const memDir = await writeStaleProject(tmp.projectsDir, 'old-proj', {
      'file1.md': 'content one',
      'file2.md': 'content two',
    });
    const issue: Issue = {
      type: 'stale_project',
      tier: 2,
      name: 'old-proj',
      detail: '100d, 2 files, 1KB',
      tokens: 200,
      path: memDir,
    };

    const cleanResult = await cleanIssues([issue]);
    expect(cleanResult.moved).toHaveLength(1);

    // Current impl: files moved into memory-backup/<name>/
    const backupDir = join(tmp.disabledDir, 'memory-backup', 'old-proj');
    expect(await exists(join(backupDir, 'file1.md'))).toBe(true);
    expect(await exists(join(backupDir, 'file2.md'))).toBe(true);

    // Restore
    const entries = await readManifest();
    const entry = entries.find((e) => e.name === 'old-proj');
    await restoreItem(entry!);

    expect(await exists(join(memDir, 'file1.md'))).toBe(true);
    expect(await exists(join(memDir, 'file2.md'))).toBe(true);
    const restored = await readFile(join(memDir, 'file1.md'), 'utf-8');
    expect(restored).toBe('content one');
  });
});
```

- [ ] **Step 3: Run test to verify it passes with current implementation**

Run: `npx vitest run src/__tests__/cleaner.test.ts`
Expected: PASS. 9 tests total. Confirms baseline behavior works for happy path.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/helpers/tmp-claude.ts src/__tests__/cleaner.test.ts
git commit -m "test: add stale_project happy-path round-trip test"
```

---

## Task 6: P0-3 — Atomic stale_project clean/restore

**Files:**
- Modify: `src/cleaner.ts:70-87` (stale_project branch)
- Modify: `src/cleaner.ts:136-143` (restore stale_project branch)
- Modify: `src/__tests__/cleaner.test.ts` (add atomicity test)

**Rationale:** The current implementation iterates `readdir` + `rename` per file. If the loop fails mid-way, half the files are in the source, half in the backup — no rollback. Replace with a single `rename(memDir → backupDir)`, which is atomic on a single filesystem. Restore does the inverse.

**Implementation outline:**

```typescript
// Before (cleaner.ts:71-77):
const backupDir = join(disabledDir, 'memory-backup', issue.name);
await mkdir(backupDir, { recursive: true });
const files = await readdir(issue.path);
for (const file of files) {
  await rename(join(issue.path, file), join(backupDir, file));
}

// After:
const backupParent = join(disabledDir, 'memory-backup');
await mkdir(backupParent, { recursive: true });
const backupDir = join(backupParent, issue.name);
await rename(issue.path, backupDir);
```

Restore mirrors this: `rename(backupDir, issue.from)` plus `mkdir(dirname(issue.from))` to ensure the project directory exists.

- [ ] **Step 1: Write failing test for atomicity**

Append to `src/__tests__/cleaner.test.ts`:

```typescript
describe('cleanIssues — stale_project atomicity', () => {
  it('leaves no partial state when restore would fail', async () => {
    const memDir = await writeStaleProject(tmp.projectsDir, 'partial-proj', {
      'a.md': 'aaa',
      'b.md': 'bbb',
    });
    const issue: Issue = {
      type: 'stale_project',
      tier: 2,
      name: 'partial-proj',
      tokens: 100,
      path: memDir,
    };

    await cleanIssues([issue]);

    // After atomic clean: memDir must not exist (was renamed away, not copied)
    expect(await exists(memDir)).toBe(false);

    // Backup is a directory, not a collection of individually-moved files
    const backupDir = join(tmp.disabledDir, 'memory-backup', 'partial-proj');
    expect(await exists(backupDir)).toBe(true);
    expect(await exists(join(backupDir, 'a.md'))).toBe(true);
    expect(await exists(join(backupDir, 'b.md'))).toBe(true);
  });

  it('atomic restore moves backup dir back in one operation', async () => {
    const memDir = await writeStaleProject(tmp.projectsDir, 'p2', { 'x.md': 'x' });
    const issue: Issue = {
      type: 'stale_project',
      tier: 2,
      name: 'p2',
      tokens: 10,
      path: memDir,
    };
    await cleanIssues([issue]);

    const entries = await readManifest();
    const entry = entries.find((e) => e.name === 'p2');
    await restoreItem(entry!);

    // After atomic restore: backup dir gone, memDir restored
    expect(await exists(join(tmp.disabledDir, 'memory-backup', 'p2'))).toBe(false);
    expect(await exists(memDir)).toBe(true);
    expect(await exists(join(memDir, 'x.md'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails with current implementation**

Run: `npx vitest run src/__tests__/cleaner.test.ts -t atomicity`

Expected: FAIL. The first test expects `await exists(memDir)` to be `false` after clean, but the current per-file loop leaves the empty directory behind (files are moved out, directory itself remains). This failure is the signal that the current implementation is non-atomic.

- [ ] **Step 3: Implement atomic clean in `src/cleaner.ts`**

Replace lines 70-87 (the `stale_project` branch in `cleanIssues`) with:

```typescript
      } else if (issue.type === 'stale_project') {
        const backupParent = join(disabledDir, 'memory-backup');
        await mkdir(backupParent, { recursive: true });
        const backupDir = join(backupParent, issue.name);
        // Atomic directory rename — no partial state possible on same FS
        await rename(issue.path, backupDir);
        const entry: ManifestEntry = {
          date: new Date().toISOString(),
          name: issue.name,
          from: issue.path,
          type: issue.type,
          tokenCount: issue.tokens,
          tier: issue.tier,
        };
        await appendManifest(entry);
        moved.push(entry);
      }
```

- [ ] **Step 4: Implement atomic restore in `src/cleaner.ts`**

Replace lines 136-143 (the `stale_project` branch in `restoreItem`) with:

```typescript
  if (entry.type === 'stale_project') {
    const backupDir = join(disabledDir, 'memory-backup', entry.name);
    await mkdir(dirname(entry.from), { recursive: true });
    // Atomic directory rename back to original location
    await rename(backupDir, entry.from);
  } else {
```

- [ ] **Step 5: Run all cleaner tests**

Run: `npx vitest run src/__tests__/cleaner.test.ts`
Expected: PASS. All 11 tests pass (including the previous Task 5 happy-path, which still works because atomic rename preserves file contents).

- [ ] **Step 6: Build to confirm no type errors**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 7: Commit**

```bash
git add src/cleaner.ts src/__tests__/cleaner.test.ts
git commit -m "fix: atomic rename for stale_project clean and restore (P0-3)"
```

---

## Task 7: Manifest v2 schema + migration

**Files:**
- Modify: `src/types.ts` (add `Manifest` interface)
- Rewrite: `src/manifest.ts`
- Create: `src/__tests__/manifest.test.ts`

**Rationale (P0-2):** Current JSONL is append-only. Restore just appends a `restored` record, and cli.ts filters at read-time — so the file grows forever. Switch to a single JSON document containing only currently-disabled entries; restore removes from the list.

**Schema:**

```typescript
interface Manifest {
  version: 2;
  entries: ManifestEntry[]; // only currently-disabled items
}
```

**Migration:** On first read, if legacy JSONL exists and JSON does not, migrate by grouping entries by `name` and dropping any whose latest action is `restored`. Rename JSONL to `.bak` for safety.

- [ ] **Step 1: Add Manifest type to `src/types.ts`**

Append to `src/types.ts`:

```typescript
export interface Manifest {
  version: 2;
  entries: ManifestEntry[];
}
```

- [ ] **Step 2: Write failing test for manifest operations**

Create `src/__tests__/manifest.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  readManifestV2,
  writeManifestV2,
  addEntry,
  removeEntry,
  migrateLegacyIfNeeded,
} from '../manifest.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';
import type { ManifestEntry } from '../types.js';

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
});

afterEach(async () => {
  await tmp.cleanup();
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('manifest v2', () => {
  it('readManifestV2 returns empty when no file exists', async () => {
    const m = await readManifestV2();
    expect(m.version).toBe(2);
    expect(m.entries).toEqual([]);
  });

  it('writeManifestV2 + readManifestV2 round-trip', async () => {
    const entry: ManifestEntry = {
      date: '2026-04-18',
      name: 'foo',
      from: '/x/foo',
      type: 'template',
      tokenCount: 100,
      tier: 1,
    };
    await writeManifestV2({ version: 2, entries: [entry] });
    const m = await readManifestV2();
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].name).toBe('foo');
  });

  it('addEntry appends to active list', async () => {
    await addEntry({ date: '2026-04-18', name: 'a', from: '/a', type: 'template' });
    await addEntry({ date: '2026-04-18', name: 'b', from: '/b', type: 'duplicate' });
    const m = await readManifestV2();
    expect(m.entries.map((e) => e.name)).toEqual(['a', 'b']);
  });

  it('removeEntry removes by name and returns removed entry', async () => {
    await addEntry({ date: '2026-04-18', name: 'a', from: '/a', type: 'template' });
    await addEntry({ date: '2026-04-18', name: 'b', from: '/b', type: 'duplicate' });

    const removed = await removeEntry('a');
    expect(removed).not.toBeNull();
    expect(removed!.name).toBe('a');

    const m = await readManifestV2();
    expect(m.entries.map((e) => e.name)).toEqual(['b']);
  });

  it('removeEntry returns null when name not found', async () => {
    const removed = await removeEntry('nothing');
    expect(removed).toBeNull();
  });

  it('migrateLegacyIfNeeded is no-op when no legacy file exists', async () => {
    await migrateLegacyIfNeeded();
    const m = await readManifestV2();
    expect(m.entries).toEqual([]);
  });

  it('migrateLegacyIfNeeded converts JSONL to JSON, drops restored entries', async () => {
    // Write legacy JSONL with mixed active+restored entries
    const legacyPath = join(tmp.disabledDir, '.claude-slim-manifest.jsonl');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(tmp.disabledDir, { recursive: true });
    const lines = [
      JSON.stringify({ date: '2026-01-01', name: 'a', from: '/a', type: 'template' }),
      JSON.stringify({ date: '2026-01-02', name: 'b', from: '/b', type: 'duplicate' }),
      JSON.stringify({ date: '2026-01-03', name: 'a', from: '/a', type: 'template', action: 'restored' }),
      JSON.stringify({ date: '2026-01-04', name: 'c', from: '/c', type: 'template' }),
    ];
    await writeFile(legacyPath, lines.join('\n') + '\n');

    await migrateLegacyIfNeeded();

    const m = await readManifestV2();
    // 'a' is restored (dropped), 'b' and 'c' remain
    expect(m.entries.map((e) => e.name).sort()).toEqual(['b', 'c']);

    // Legacy file renamed to .bak
    expect(await exists(legacyPath)).toBe(false);
    expect(await exists(legacyPath + '.bak')).toBe(true);
  });

  it('migrateLegacyIfNeeded is idempotent (safe to call multiple times)', async () => {
    await addEntry({ date: '2026-04-18', name: 'a', from: '/a', type: 'template' });
    await migrateLegacyIfNeeded(); // no legacy file
    const m = await readManifestV2();
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].name).toBe('a');
  });

  it('readManifestV2 auto-triggers migration from legacy file', async () => {
    const legacyPath = join(tmp.disabledDir, '.claude-slim-manifest.jsonl');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(tmp.disabledDir, { recursive: true });
    await writeFile(
      legacyPath,
      JSON.stringify({ date: '2026-01-01', name: 'xyz', from: '/xyz', type: 'template' }) + '\n',
    );

    const m = await readManifestV2();
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].name).toBe('xyz');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/manifest.test.ts`
Expected: FAIL — functions `readManifestV2`, `writeManifestV2`, `addEntry`, `removeEntry`, `migrateLegacyIfNeeded` not exported.

- [ ] **Step 4: Rewrite `src/manifest.ts`**

Replace entire file with:

```typescript
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import type { Manifest, ManifestEntry } from './types.js';
import {
  getDisabledDir as getDir,
  getManifestPath,
  getLegacyManifestPath,
} from './paths.js';

export function getDisabledDir(): string {
  return getDir();
}

export async function ensureDisabledDir(): Promise<void> {
  await mkdir(getDisabledDir(), { recursive: true });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function parseJsonl(content: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // Skip corrupted lines
    }
  }
  return entries;
}

function collapseLegacy(entries: ManifestEntry[]): ManifestEntry[] {
  // Group by name, keep only those whose latest action is NOT 'restored'
  const byName = new Map<string, ManifestEntry[]>();
  for (const e of entries) {
    const list = byName.get(e.name) ?? [];
    list.push(e);
    byName.set(e.name, list);
  }

  const active: ManifestEntry[] = [];
  for (const [, list] of byName) {
    const latest = list[list.length - 1];
    if (latest.action === 'restored') continue;
    // Use the first non-restored entry (earliest clean record) as the canonical source
    const clean = list.find((e) => e.action !== 'restored');
    if (clean) active.push(clean);
  }
  return active;
}

export async function migrateLegacyIfNeeded(): Promise<void> {
  const legacyPath = getLegacyManifestPath();
  const newPath = getManifestPath();

  if (!(await pathExists(legacyPath))) return;
  if (await pathExists(newPath)) return; // already migrated

  const content = await readFile(legacyPath, 'utf-8');
  const legacyEntries = parseJsonl(content);
  const activeEntries = collapseLegacy(legacyEntries);

  await ensureDisabledDir();
  const manifest: Manifest = { version: 2, entries: activeEntries };
  await writeFile(newPath, JSON.stringify(manifest, null, 2));
  await rename(legacyPath, legacyPath + '.bak');
}

export async function readManifestV2(): Promise<Manifest> {
  await migrateLegacyIfNeeded();

  const newPath = getManifestPath();
  try {
    const content = await readFile(newPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && parsed.version === 2 && Array.isArray(parsed.entries)) {
      return parsed as Manifest;
    }
  } catch {
    // fall through to empty manifest
  }
  return { version: 2, entries: [] };
}

export async function writeManifestV2(manifest: Manifest): Promise<void> {
  await ensureDisabledDir();
  await writeFile(getManifestPath(), JSON.stringify(manifest, null, 2));
}

export async function addEntry(entry: ManifestEntry): Promise<void> {
  const m = await readManifestV2();
  m.entries.push(entry);
  await writeManifestV2(m);
}

export async function removeEntry(name: string): Promise<ManifestEntry | null> {
  const m = await readManifestV2();
  const idx = m.entries.findIndex((e) => e.name === name);
  if (idx === -1) return null;
  const [removed] = m.entries.splice(idx, 1);
  await writeManifestV2(m);
  return removed;
}

// --- Legacy-compatible API (still used by cleaner/cli pending Task 8) ---

export async function readManifest(): Promise<ManifestEntry[]> {
  const m = await readManifestV2();
  return m.entries;
}

export async function appendManifest(entry: ManifestEntry): Promise<void> {
  await addEntry(entry);
}
```

- [ ] **Step 5: Run manifest tests to verify they pass**

Run: `npx vitest run src/__tests__/manifest.test.ts`
Expected: PASS. 9 tests pass.

- [ ] **Step 6: Run all tests to confirm no regression**

Run: `npm test`
Expected: PASS. 52+ tests total (41 prior + 11 cleaner + 9 manifest - some overlap).

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/manifest.ts src/__tests__/manifest.test.ts
git commit -m "feat: manifest v2 schema with legacy JSONL migration (P0-2)"
```

---

## Task 8: Use v2 manifest in cleaner + cli restore, verify bounded growth

**Files:**
- Modify: `src/cli.ts:59-128` (restore flow)
- Modify: `src/__tests__/cleaner.test.ts` (bounded-growth test)

The v2 API is already in place (Task 7), and cleaner already uses `appendManifest` which now delegates to `addEntry`. What's missing: cli.ts restore flow needs to remove active entries when the user restores. Currently it just appends a `restored` record.

- [ ] **Step 1: Write failing bounded-growth test**

Append to `src/__tests__/cleaner.test.ts`:

```typescript
import { readManifestV2 } from '../manifest.js';

describe('manifest bounded growth', () => {
  it('restore removes entry so manifest stays bounded across cycles', async () => {
    const skillPath = await writeSkill(tmp.skillsDir, 'cycler', 'x');
    const issue: Issue = {
      type: 'template',
      tier: 1,
      name: 'cycler',
      tokens: 10,
      path: skillPath,
    };

    // 10 clean/restore cycles
    for (let i = 0; i < 10; i++) {
      // Ensure skill dir exists before each clean (restore put it back)
      if (!(await exists(skillPath))) {
        await writeSkill(tmp.skillsDir, 'cycler', 'x');
      }
      await cleanIssues([issue]);
      const m1 = await readManifestV2();
      expect(m1.entries.filter((e) => e.name === 'cycler')).toHaveLength(1);

      const entry = m1.entries.find((e) => e.name === 'cycler')!;
      await restoreItem(entry);
      const m2 = await readManifestV2();
      expect(m2.entries.filter((e) => e.name === 'cycler')).toHaveLength(0);
    }

    // After 10 cycles, manifest should be empty (or at least not linear in cycle count)
    const final = await readManifestV2();
    expect(final.entries).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/cleaner.test.ts -t bounded`
Expected: FAIL. The manifest entry for `cycler` is never removed — `restoreItem` only appends a `restored` record via `appendManifest`, but the old `addEntry` record persists.

- [ ] **Step 3: Update `restoreItem` in `src/cleaner.ts` to remove from manifest**

In `src/cleaner.ts`, update the import at line 4 to add `removeEntry`:

```typescript
import { appendManifest, ensureDisabledDir, getDisabledDir, removeEntry } from './manifest.js';
```

Then find the trailing block in `restoreItem` (lines 151-159):

```typescript
  const restoreEntry: ManifestEntry = {
    date: new Date().toISOString(),
    name: entry.name,
    from: entry.from,
    type: entry.type,
    action: 'restored',
  };
  await appendManifest(restoreEntry);
```

Replace with:

```typescript
  await removeEntry(entry.name);
```

- [ ] **Step 4: Update cli.ts restore flow**

In `src/cli.ts`, lines 62-74, the current code reads manifest, filters out `restored` names, filters non-restorable types. With v2, manifest contains only active entries already — the `restoredNames` filtering becomes a no-op.

Replace lines 62-74 with:

```typescript
    const entries = await readManifest();
    // v2 manifest contains only active entries. No need to filter 'restored'.
    const NON_RESTORABLE = new Set(['temp_cache', 'disabled_plugin']);
    const restorable = entries.filter((e) => !NON_RESTORABLE.has(e.type));
    const infoOnly = entries.filter((e) => NON_RESTORABLE.has(e.type));
```

Remove the `disabled` and `restoredNames` locals and the `disabled.filter(...)` call.

- [ ] **Step 5: Run bounded-growth test to confirm it now passes**

Run: `npx vitest run src/__tests__/cleaner.test.ts -t bounded`
Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass. Total suite green.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 8: Manual smoke test**

Run (from project root):
```bash
node dist/cli.js scan
```
Expected: Scan output matches prior behavior (reads real `~/.claude`).

Run:
```bash
node dist/cli.js restore
```
Expected: Either "Nothing to restore" or lists prior disabled items correctly.

- [ ] **Step 9: Commit**

```bash
git add src/cleaner.ts src/cli.ts src/__tests__/cleaner.test.ts
git commit -m "feat: restore removes entry from manifest v2 (P0-2 bounded growth)"
```

- [ ] **Step 10: Bump version and update CHANGELOG (if present)**

Update `package.json` version from `2.1.0` to `2.2.0`.

Run: `git add package.json && git commit -m "chore: bump version to 2.2.0"`

---

## Summary

| Task | P0 Item | Primary Change | Tests Added | Breaking |
|---|---|---|---|---|
| 1 | — | Extract `paths.ts` | 7 | No |
| 2 | #1 | Test harness + broken_symlink | 1 | No |
| 3 | #1 | Round-trip for 4 skill types | 5 | No |
| 4 | #1 | Round-trip for temp_cache | 2 | No |
| 5 | #1 | Round-trip for stale_project | 1 | No |
| 6 | #3 | Atomic stale_project | 2 | No |
| 7 | #2 | Manifest v2 + migration | 9 | Yes (format) |
| 8 | #2 | Restore removes entry | 1 | No (behavior preserved) |

**Total:** 8 tasks, 28 new tests, 1 breaking change (manifest file format, with auto-migration).

## Execution Notes

- Each task ends with passing `npm test` and clean `npm run build`. Project is shippable after any task.
- Task order is load-bearing: Task 1 enables all subsequent tests; Task 7 must precede Task 8.
- Task 8 includes a `node dist/cli.js` smoke test on the real user environment — it's safe because the v2 migration is idempotent and non-destructive (legacy file renamed to `.bak`).
- If Task 7 migration fails on a user's existing manifest, the legacy JSONL is preserved untouched (we only rename after successful write of new file). Add a try/catch wrapper if additional caution is desired.
