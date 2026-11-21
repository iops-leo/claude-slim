import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { afterAll } from 'vitest';

// A developer shell that points at a second profile (CLAUDE_CONFIG_DIR) or a
// relocated Codex home must not leak into fixtures built under a fake HOME.
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;
delete process.env.CLAUDE_CODE_PROJECT_DIR_NAME;

// scan() and doctor shell out to `claude plugin list`. The real binary reads
// and writes the developer's profile (it left `backups/.claude.json.backup.*`
// in the repo root), so a stub that prints nothing stands in for it — the same
// answer CI, where Claude Code is not installed, already gets. Tests that need
// specific output prepend their own stub to PATH.
const bin = mkdtempSync(join(tmpdir(), 'claude-slim-test-bin-'));
writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexit 0\n');
chmodSync(join(bin, 'claude'), 0o755);
process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`;

afterAll(() => {
  rmSync(bin, { recursive: true, force: true });
});
