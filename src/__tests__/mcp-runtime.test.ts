import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { addMcpServerJson } from '../mcp-runtime.js';

describe('addMcpServerJson errors', () => {
  let bin: string;
  beforeEach(async () => {
    bin = await mkdtemp(join(tmpdir(), 'fake-claude-'));
    // A `claude` that fails without writing anything to stderr.
    await writeFile(join(bin, 'claude'), '#!/bin/sh\nexit 3\n');
    await chmod(join(bin, 'claude'), 0o755);
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(bin, { recursive: true, force: true });
  });

  it('never echoes the definition (argv) into the error message', async () => {
    const err = await addMcpServerJson('srv', 'user', { env: { TOKEN: 'sk-very-secret' } }, bin).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('sk-very-secret');
    expect((err as Error).message).toMatch(/add-json/);
  });
});
