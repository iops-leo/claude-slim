import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as childProcess from 'node:child_process';

// Mock node:child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { disablePlugin, enablePlugin } from '../plugin-runtime.js';

function makeExecFile(opts: {
  code?: number;
  stderr?: string;
  error?: Error;
}) {
  return vi.fn((_file: string, _args: string[], _options: unknown, cb: (...a: unknown[]) => void) => {
    if (opts.error) {
      cb(opts.error, '', opts.stderr ?? '');
    } else if (opts.code && opts.code !== 0) {
      const err = Object.assign(new Error('non-zero exit'), { code: opts.code });
      cb(err, '', opts.stderr ?? '');
    } else {
      cb(null, '', opts.stderr ?? '');
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── disablePlugin ────────────────────────────────────────────────────────────

describe('disablePlugin', () => {
  it('calls execFile with correct args for a valid name', async () => {
    const mock = makeExecFile({});
    vi.mocked(childProcess.execFile).mockImplementation(mock as never);

    await disablePlugin('valid-name');

    expect(mock).toHaveBeenCalledOnce();
    const [file, args, options] = mock.mock.calls[0] as [string, string[], { timeout: number }];
    expect(file).toBe('claude');
    expect(args).toEqual(['plugin', 'disable', 'valid-name']);
    expect(options.timeout).toBe(30000);
  });

  it('throws on suspicious name (semicolon) without calling execFile', async () => {
    const mock = makeExecFile({});
    vi.mocked(childProcess.execFile).mockImplementation(mock as never);

    await expect(disablePlugin('foo;bar')).rejects.toThrow(
      'Refusing to operate on suspicious plugin name: foo;bar',
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it('throws on empty name without calling execFile', async () => {
    const mock = makeExecFile({});
    vi.mocked(childProcess.execFile).mockImplementation(mock as never);

    await expect(disablePlugin('')).rejects.toThrow(
      'Refusing to operate on suspicious plugin name: ',
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it('throws when execFile exits with non-zero code, including stderr', async () => {
    const mock = makeExecFile({ code: 1, stderr: 'plugin not found' });
    vi.mocked(childProcess.execFile).mockImplementation(mock as never);

    await expect(disablePlugin('my-plugin')).rejects.toThrow('plugin not found');
  });

  it('throws on timeout error', async () => {
    const timeoutErr = Object.assign(new Error('Command timed out'), { code: 'ETIMEDOUT' });
    const mock = makeExecFile({ error: timeoutErr });
    vi.mocked(childProcess.execFile).mockImplementation(mock as never);

    await expect(disablePlugin('my-plugin')).rejects.toThrow('Command timed out');
  });
});

// ─── enablePlugin ─────────────────────────────────────────────────────────────

describe('enablePlugin', () => {
  it('calls execFile with correct args for a valid name', async () => {
    const mock = makeExecFile({});
    vi.mocked(childProcess.execFile).mockImplementation(mock as never);

    await enablePlugin('valid-name');

    expect(mock).toHaveBeenCalledOnce();
    const [file, args, options] = mock.mock.calls[0] as [string, string[], { timeout: number }];
    expect(file).toBe('claude');
    expect(args).toEqual(['plugin', 'enable', 'valid-name']);
    expect(options.timeout).toBe(30000);
  });

  it('throws on suspicious name (semicolon) without calling execFile', async () => {
    const mock = makeExecFile({});
    vi.mocked(childProcess.execFile).mockImplementation(mock as never);

    await expect(enablePlugin('foo;bar')).rejects.toThrow(
      'Refusing to operate on suspicious plugin name: foo;bar',
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it('throws on empty name without calling execFile', async () => {
    const mock = makeExecFile({});
    vi.mocked(childProcess.execFile).mockImplementation(mock as never);

    await expect(enablePlugin('')).rejects.toThrow(
      'Refusing to operate on suspicious plugin name: ',
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it('throws when execFile exits with non-zero code, including stderr', async () => {
    const mock = makeExecFile({ code: 1, stderr: 'plugin not found' });
    vi.mocked(childProcess.execFile).mockImplementation(mock as never);

    await expect(enablePlugin('my-plugin')).rejects.toThrow('plugin not found');
  });

  it('throws on timeout error', async () => {
    const timeoutErr = Object.assign(new Error('Command timed out'), { code: 'ETIMEDOUT' });
    const mock = makeExecFile({ error: timeoutErr });
    vi.mocked(childProcess.execFile).mockImplementation(mock as never);

    await expect(enablePlugin('my-plugin')).rejects.toThrow('Command timed out');
  });
});
