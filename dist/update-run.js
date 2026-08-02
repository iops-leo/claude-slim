import { execFile } from 'node:child_process';
// Running the upgrade.
//
// v2.9.0 shipped detection only, on the reasoning that updating is the package
// manager's job. Half of that was right and half was not. Writing into the
// plugin directory ourselves would indeed corrupt an install — but *invoking*
// the package manager is something this tool already does elsewhere
// (`claude plugin disable` during unused-plugin cleanup). Refusing to invoke it
// here was inconsistent, not principled.
//
// So: still never write to those directories directly. Just run the command the
// user would have typed, after showing it to them.
//
// Every argv below is a fixed literal. Nothing from the environment, the
// manifest, or user input is interpolated, and execFile never routes through a
// shell — so there is no argument-injection surface to guard.
const STEP_TIMEOUT_MS = 180_000;
export function planUpdate(method) {
    switch (method) {
        case 'plugin':
            return {
                runnable: true,
                steps: [
                    // Refresh the marketplace first; otherwise `plugin update` compares
                    // against a stale manifest and reports "already up to date".
                    { file: 'claude', args: ['plugin', 'marketplace', 'update', 'claude-slim'] },
                    // The qualified id is required: the bare name fails with
                    // `Plugin "claude-slim" not found` when a marketplace shares its name.
                    { file: 'claude', args: ['plugin', 'update', 'claude-slim@claude-slim'] },
                ],
            };
        case 'global':
            return {
                runnable: true,
                steps: [{ file: 'npm', args: ['install', '-g', 'claude-slim@latest'] }],
            };
        case 'npx':
            return {
                runnable: false,
                steps: [],
                guidance: 'npx resolves the latest version on every invocation, so there is nothing to update. ' +
                    'If a stale copy is cached, run `npx claude-slim@latest` once to refresh it.',
            };
        case 'source':
            return {
                runnable: false,
                steps: [],
                guidance: 'This is a source checkout. Updating it means pulling your own repository, ' +
                    'which claude-slim will not do on your behalf — run `git pull && npm install` yourself.',
            };
        default:
            return {
                runnable: false,
                steps: [],
                guidance: 'Could not tell how this copy was installed, so no upgrade command can be chosen safely. ' +
                    'Update it the same way you installed it.',
            };
    }
}
/** Human-readable rendering of a step, matching what the user would type. */
export function renderStep(step) {
    return [step.file, ...step.args].join(' ');
}
function runStep(step) {
    return new Promise((resolve) => {
        execFile(step.file, step.args, { timeout: STEP_TIMEOUT_MS }, (err, stdout, stderr) => {
            const output = [stdout, stderr].map((s) => s?.trim()).filter(Boolean).join('\n');
            resolve({ step, ok: !err, output: err ? `${err.message}${output ? `\n${output}` : ''}` : output });
        });
    });
}
/**
 * Run the plan's steps in order, stopping at the first failure.
 *
 * Sequential rather than parallel, and halting on error, because step 2 depends
 * on step 1 having refreshed the marketplace — running it against a stale
 * manifest would report success while changing nothing.
 */
export async function runUpdate(plan) {
    const results = [];
    for (const step of plan.steps) {
        const result = await runStep(step);
        results.push(result);
        if (!result.ok)
            break;
    }
    return results;
}
/**
 * Decide how to gate an update that will modify the user's install.
 *
 * Refusing when there is no TTY is the important case: piped into a script or a
 * CI job, there is nobody to answer the prompt, and silently proceeding would
 * mean a tool that changes an installation without anyone agreeing to it.
 * `--yes` is how you say so deliberately.
 */
export function confirmDecision(opts, isTTY) {
    if (opts.yes)
        return 'run';
    return isTTY ? 'prompt' : 'refuse';
}
