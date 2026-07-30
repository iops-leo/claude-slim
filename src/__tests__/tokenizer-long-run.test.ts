import { describe, it, expect, beforeAll } from 'vitest';
import { getEncoding } from 'js-tiktoken';
import { initTokenizer, countTokens } from '../tokenizer.js';

/**
 * Regression guard for a scan-wedging hang.
 *
 * js-tiktoken's BPE is quadratic in the length of a single whitespace-free run.
 * Ordinary prose is unaffected — the pre-tokenizer splits on whitespace — but one
 * unbroken run is not: 800 characters of Hangul measured ~450ms, 3,200 ~6.8s, and
 * a 60,000-character run hung `claude-slim scan` past 20s with no output. A real
 * installed skill (`graphify`) already carried a 530-character JSON schema line.
 *
 * countTokens now estimates runs past MAX_ENCODE_RUN (512) instead of encoding
 * them, so the fix must hold two properties: bounded time on pathological input,
 * and byte-identical counts on everything else.
 */

let encoder: { encode: (s: string) => number[] };

beforeAll(async () => {
  await initTokenizer();
  encoder = getEncoding('cl100k_base');
});

const exact = (s: string): number => encoder.encode(s).length;

describe('countTokens — pathological whitespace-free runs', () => {
  it('completes quickly on a 60k-character unbroken run', () => {
    const start = Date.now();
    const tokens = countTokens('x'.repeat(60_000));
    const elapsed = Date.now() - start;

    expect(tokens).toBeGreaterThan(0);
    // Encoding this directly took minutes. One second is already generous.
    expect(elapsed).toBeLessThan(1_000);
  });

  it('completes quickly on unbroken Hangul, the worst measured case', () => {
    const start = Date.now();
    const tokens = countTokens('가'.repeat(20_000));
    const elapsed = Date.now() - start;

    expect(tokens).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('completes quickly with many long runs in one document', () => {
    const doc = Array.from({ length: 20 }, () => 'y'.repeat(3_000)).join('\n\n');
    const start = Date.now();
    countTokens(doc);
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it('handles a long run at the very start and very end', () => {
    expect(countTokens('z'.repeat(2_000) + ' tail')).toBeGreaterThan(0);
    expect(countTokens('head ' + 'z'.repeat(2_000))).toBeGreaterThan(0);
    expect(countTokens('z'.repeat(2_000))).toBeGreaterThan(0);
  });
});

describe('countTokens — no drift on well-formed text', () => {
  it('matches the encoder exactly for ordinary prose', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(200);
    expect(countTokens(text)).toBe(exact(text));
  });

  it('matches the encoder exactly for Korean prose', () => {
    const text = '이 스킬은 토큰 사용량을 측정하고 정리합니다. '.repeat(150);
    expect(countTokens(text)).toBe(exact(text));
  });

  it('matches the encoder exactly for a realistic SKILL.md', () => {
    const text = [
      '---',
      'name: example',
      'description: Does a thing, and explains what it does at some length.',
      '---',
      '',
      '# Example',
      '',
      'Body text with `code`, [links](https://example.com/some/path), and lists:',
      '',
      '- one',
      '- two',
      '',
      '```bash',
      'npx claude-slim scan --json | jq .',
      '```',
    ].join('\n');
    expect(countTokens(text)).toBe(exact(text));
  });

  it('matches the encoder exactly at the threshold boundary', () => {
    // 512 is the longest run still encoded directly.
    const atLimit = `head ${'a'.repeat(512)} tail`;
    expect(countTokens(atLimit)).toBe(exact(atLimit));
  });

  it('stays close to the encoder just past the threshold', () => {
    const overLimit = `head ${'a'.repeat(513)} tail`;
    const bounded = countTokens(overLimit);
    const direct = exact(overLimit);
    // Sampling the run's own prefix keeps this tight; a fixed chars-per-token
    // divisor was off by ~100% here because repeated ASCII compresses to
    // 8 chars/token while the divisor assumed 4.
    expect(Math.abs(bounded - direct) / direct).toBeLessThan(0.05);
  });

  // Runs are kept to ~1,200 chars and the timeout is raised, because the
  // assertion needs the UNBOUNDED encoder as its reference — the very thing this
  // module exists to avoid calling on long runs. Hangul at 4,000 chars takes
  // ~10s to encode directly, which blew the default 5s budget.
  it('stays within 5% across run types with very different token densities', () => {
    // Measured density over 1,000-char runs: ~0.8 chars/token for Hangul,
    // ~1.4 for base64, ~8.0 for a repeated ASCII character.
    const runs = [
      'a'.repeat(1_200),
      '가나다라마바사'.repeat(200).slice(0, 1_200),
      Buffer.from('x'.repeat(900)).toString('base64').slice(0, 1_200),
      'https://example.com/a?b=c&d=e'.repeat(60).slice(0, 1_200),
    ];
    for (const run of runs) {
      const bounded = countTokens(run);
      const direct = exact(run);
      expect(Math.abs(bounded - direct) / direct).toBeLessThan(0.05);
    }
  }, 30_000);

  it('stays within 1% on a document that mixes prose and one long run', () => {
    const text =
      'Normal sentences carry most of the content here. '.repeat(300) +
      '\n' +
      JSON.stringify({ schema: 'x'.repeat(1_500) });
    const bounded = countTokens(text);
    const direct = exact(text);
    expect(Math.abs(bounded - direct) / direct).toBeLessThan(0.01);
  });

  it('handles empty and whitespace-only input', () => {
    expect(countTokens('')).toBe(0);
    expect(countTokens('   \n\n  ')).toBe(exact('   \n\n  '));
  });

  it('does not treat a long whitespace stretch as a pathological run', () => {
    // \S{513,} must not match whitespace — this should take the fast path.
    const text = ' '.repeat(2_000);
    expect(countTokens(text)).toBe(exact(text));
  });
});
