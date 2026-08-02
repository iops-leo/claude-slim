import { describe, it, expect } from 'vitest';
import { confirmDecision, planUpdate, renderStep, runUpdate } from '../update-run.js';
import type { InstallMethod } from '../update-check.js';

/**
 * The safety property here is narrow but absolute: every argv is a fixed
 * literal. If a future edit ever interpolates a version, a path, or anything
 * from a manifest into these arrays, the assertions below should fail loudly —
 * that is what they are for.
 */

describe('planUpdate — what runs where', () => {
  it('refreshes the marketplace before updating the plugin', () => {
    const plan = planUpdate('plugin');
    expect(plan.runnable).toBe(true);
    expect(plan.steps).toHaveLength(2);
    // Order matters: updating against a stale manifest reports success while
    // changing nothing.
    expect(plan.steps[0].args).toEqual(['plugin', 'marketplace', 'update', 'claude-slim']);
    expect(plan.steps[1].args).toEqual(['plugin', 'update', 'claude-slim@claude-slim']);
  });

  it('uses the qualified plugin id, which is the form that actually resolves', () => {
    // `claude plugin update claude-slim` fails with "not found" when the
    // marketplace shares the plugin's name — exactly this project's situation.
    expect(planUpdate('plugin').steps[1].args).toContain('claude-slim@claude-slim');
  });

  it('installs the latest tag globally for a global npm install', () => {
    const plan = planUpdate('global');
    expect(plan.runnable).toBe(true);
    expect(plan.steps).toEqual([{ file: 'npm', args: ['install', '-g', 'claude-slim@latest'] }]);
  });

  it('runs nothing for npx, because there is nothing to update', () => {
    const plan = planUpdate('npx');
    expect(plan.runnable).toBe(false);
    expect(plan.steps).toEqual([]);
    expect(plan.guidance).toMatch(/every invocation/);
  });

  it('refuses to touch a source checkout — that is the user their own repository', () => {
    const plan = planUpdate('source');
    expect(plan.runnable).toBe(false);
    expect(plan.steps).toEqual([]);
    expect(plan.guidance).toMatch(/will not do on your behalf/);
  });

  it('runs nothing when the install method is unknown', () => {
    const plan = planUpdate('unknown' as InstallMethod);
    expect(plan.runnable).toBe(false);
    expect(plan.steps).toEqual([]);
    expect(plan.guidance).toBeTruthy();
  });
});

describe('planUpdate — argv is fixed, never interpolated', () => {
  const methods: InstallMethod[] = ['plugin', 'global', 'npx', 'source', 'unknown'];

  it('never shells out to a shell interpreter', () => {
    for (const m of methods) {
      for (const step of planUpdate(m).steps) {
        expect(['claude', 'npm']).toContain(step.file);
        expect(step.file).not.toMatch(/sh$|bash|zsh|cmd|powershell/);
      }
    }
  });

  it('contains no shell metacharacters in any argument', () => {
    for (const m of methods) {
      for (const step of planUpdate(m).steps) {
        for (const arg of step.args) {
          expect(arg).not.toMatch(/[;&|`$><(){}[\]\\'"]/);
        }
      }
    }
  });

  it('produces identical plans on repeated calls — nothing is environment-derived', () => {
    for (const m of methods) {
      expect(planUpdate(m)).toEqual(planUpdate(m));
    }
  });
});

describe('renderStep', () => {
  it('renders the command exactly as a user would type it', () => {
    expect(renderStep({ file: 'npm', args: ['install', '-g', 'claude-slim@latest'] }))
      .toBe('npm install -g claude-slim@latest');
  });
});

describe('runUpdate', () => {
  it('returns nothing for a plan with no steps', async () => {
    expect(await runUpdate(planUpdate('npx'))).toEqual([]);
  });

  it('stops at the first failing step instead of pressing on', async () => {
    // `false` exits non-zero; the second step must never run, because in the
    // real plan step 2 depends on step 1 having succeeded.
    const plan = {
      runnable: true,
      steps: [
        { file: 'false', args: [] },
        { file: 'echo', args: ['should-not-run'] },
      ],
    };
    const results = await runUpdate(plan);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
  });

  it('reports success and captures output when a step succeeds', async () => {
    const results = await runUpdate({
      runnable: true,
      steps: [{ file: 'echo', args: ['done'] }],
    });
    expect(results[0].ok).toBe(true);
    expect(results[0].output).toContain('done');
  });

  it('reports a missing executable as a failure rather than throwing', async () => {
    const results = await runUpdate({
      runnable: true,
      steps: [{ file: 'claude-slim-no-such-binary', args: [] }],
    });
    expect(results[0].ok).toBe(false);
    expect(results[0].output).toBeTruthy();
  });
});

describe('confirmDecision — the gate before anything is modified', () => {
  it('prompts an interactive user', () => {
    expect(confirmDecision({}, true)).toBe('prompt');
  });

  it('refuses when there is no TTY to answer the prompt', () => {
    // Piped into a script or a CI job, nobody can consent — proceeding anyway
    // would change an installation with no one agreeing to it.
    expect(confirmDecision({}, false)).toBe('refuse');
  });

  it('runs when --yes was passed, TTY or not', () => {
    expect(confirmDecision({ yes: true }, true)).toBe('run');
    expect(confirmDecision({ yes: true }, false)).toBe('run');
  });

  it('treats an absent flag the same as false', () => {
    expect(confirmDecision({ yes: undefined }, false)).toBe('refuse');
  });
});
