import type { InstallMethod } from './update-check.js';
export interface UpdateStep {
    file: string;
    args: string[];
}
export interface UpdatePlan {
    /** false when there is nothing to execute — see `guidance`. */
    runnable: boolean;
    steps: UpdateStep[];
    /** Why nothing runs, for the methods where that is the correct answer. */
    guidance?: string;
}
export declare function planUpdate(method: InstallMethod): UpdatePlan;
/** Human-readable rendering of a step, matching what the user would type. */
export declare function renderStep(step: UpdateStep): string;
export interface StepResult {
    step: UpdateStep;
    ok: boolean;
    output: string;
}
/**
 * Run the plan's steps in order, stopping at the first failure.
 *
 * Sequential rather than parallel, and halting on error, because step 2 depends
 * on step 1 having refreshed the marketplace — running it against a stale
 * manifest would report success while changing nothing.
 */
export declare function runUpdate(plan: UpdatePlan): Promise<StepResult[]>;
export type ConfirmDecision = 'run' | 'prompt' | 'refuse';
/**
 * Decide how to gate an update that will modify the user's install.
 *
 * Refusing when there is no TTY is the important case: piped into a script or a
 * CI job, there is nobody to answer the prompt, and silently proceeding would
 * mean a tool that changes an installation without anyone agreeing to it.
 * `--yes` is how you say so deliberately.
 */
export declare function confirmDecision(opts: {
    yes?: boolean;
}, isTTY: boolean): ConfirmDecision;
