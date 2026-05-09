#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { Command } from 'commander';
import { initTokenizer, flushCache } from './tokenizer.js';
import { scan, SKILL_PROMPT_OVERHEAD_TOKENS } from './scanner.js';
import { cleanIssues, restoreItem } from './cleaner.js';
import { readManifest } from './manifest.js';
import { formatScanSummary, formatReportBox, calculateReport, } from './report.js';
import { collectDoctorReport, formatDoctorReport } from './doctor.js';
import { resolveSelection, resolveRestoreSelection } from './selection.js';
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const { version: PKG_VERSION } = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const program = new Command();
program
    .name('claude-slim')
    .description('Analyze and reduce Claude Code token overhead')
    .version(PKG_VERSION);
// --- scan ---
program
    .command('scan')
    .description('Scan environment and report issues')
    .option('--json', 'Output raw JSON')
    .option('--lookback-days <n>', 'Days of session history for skill-usage analysis', '60')
    .action(async (opts) => {
    await initTokenizer();
    const result = await scan({ lookbackDays: parseInt(opts.lookbackDays, 10) || 60 });
    await flushCache();
    if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
    }
    else {
        console.log(formatScanSummary(result));
    }
});
// --- doctor ---
program
    .command('doctor')
    .description('Check local Claude Code environment and scanner fidelity')
    .option('--json', 'Output raw JSON')
    .option('--lookback-days <n>', 'Days of session history for skill-usage analysis', '60')
    .action(async (opts) => {
    const report = await collectDoctorReport({
        lookbackDays: parseInt(opts.lookbackDays, 10) || 60,
    });
    if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
    }
    else {
        console.log(formatDoctorReport(report));
    }
});
// --- clean ---
program
    .command('clean')
    .description('Interactive cleanup of detected issues')
    .option('--dry-run', 'Show what would happen without making changes')
    .option('--auto', 'Non-interactive: auto-select Tier 1 items only')
    .option('--sessions-per-day <n>', 'Sessions per day for savings estimate', '2')
    .option('--lookback-days <n>', 'Days of session history for skill-usage analysis', '60')
    .action(async (opts) => {
    await runCleanPipeline({
        dryRun: !!opts.dryRun,
        auto: !!opts.auto,
        sessionsPerDay: parseInt(opts.sessionsPerDay, 10) || 2,
        lookbackDays: parseInt(opts.lookbackDays, 10) || 60,
    });
});
// --- restore ---
program
    .command('restore')
    .description('Restore previously disabled items')
    .action(async () => {
    const entries = await readManifest();
    // v2 manifest contains only currently-disabled entries (restored ones are removed)
    const disabled = entries.filter((e) => e.type !== 'broken_symlink');
    const NON_RESTORABLE = new Set(['temp_cache', 'disabled_plugin']);
    const restorable = disabled.filter((e) => !NON_RESTORABLE.has(e.type));
    const infoOnly = disabled.filter((e) => NON_RESTORABLE.has(e.type));
    if (restorable.length === 0 && infoOnly.length === 0) {
        console.log('\n  Nothing to restore.\n');
        return;
    }
    if (restorable.length > 0) {
        console.log('\n  Restorable items:\n');
        for (let i = 0; i < restorable.length; i++) {
            const e = restorable[i];
            const date = new Date(e.date).toLocaleDateString();
            console.log(`    ${i + 1}. ${e.name} (${e.type}, disabled ${date})`);
        }
    }
    if (infoOnly.length > 0) {
        console.log('\n  \x1b[90mNon-restorable (for reference):\x1b[0m');
        for (const e of infoOnly) {
            const date = new Date(e.date).toLocaleDateString();
            const hint = e.type === 'disabled_plugin'
                ? `reinstall: claude plugin install ${e.name}`
                : 'deleted, cannot restore';
            console.log(`    \x1b[90m\u2022 ${e.name} (${date}) — ${hint}\x1b[0m`);
        }
    }
    if (restorable.length === 0) {
        console.log('\n  No items can be restored.\n');
        return;
    }
    console.log('');
    const selection = await askUser('  Restore (all / numbers / none): ');
    const indices = resolveRestoreSelection(selection, restorable.length);
    if (indices.length === 0) {
        console.log('\n  Cancelled.\n');
        return;
    }
    let restored = 0;
    for (const idx of indices) {
        try {
            await restoreItem(restorable[idx]);
            console.log(`  \x1b[32m\u2713\x1b[0m Restored: ${restorable[idx].name}`);
            restored++;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`  \x1b[31m\u2717\x1b[0m ${restorable[idx].name}: ${msg}`);
        }
    }
    console.log(`\n  Restored ${restored} item(s).\n`);
});
// --- report ---
program
    .command('report')
    .description('Show savings report from last clean')
    .option('--sessions-per-day <n>', 'Sessions per day for savings estimate', '2')
    .option('--lookback-days <n>', 'Days of session history for skill-usage analysis', '60')
    .action(async (opts) => {
    await initTokenizer();
    const result = await scan({ lookbackDays: parseInt(opts.lookbackDays, 10) || 60 });
    const entries = await readManifest();
    const movedEntries = entries.filter((e) => e.tokenCount && e.tokenCount > 0);
    if (movedEntries.length === 0) {
        console.log('\n  No previous cleanup found. Run `claude-slim clean` first.\n');
        await flushCache();
        return;
    }
    const sessionsPerDay = parseInt(opts.sessionsPerDay, 10) || 2;
    // Reconstruct "before" state: current + what was removed.
    // Only skill-type entries contributed to the per-skill prompt overhead
    // (stale_project restores memory tokens separately; broken_symlink/
    // temp_cache never counted toward totalTokensBefore).
    const SKILL_TYPES = new Set([
        'template', 'duplicate', 'skill_dup', 'oversized_skill', 'unused_skill',
    ]);
    const removedSkillEntries = movedEntries.filter((e) => SKILL_TYPES.has(e.type));
    const removedMemoryTokens = movedEntries
        .filter((e) => e.type === 'stale_project')
        .reduce((sum, e) => sum + (e.tokenCount || 0), 0);
    const totalBefore = result.totalTokensBefore
        + removedSkillEntries.length * SKILL_PROMPT_OVERHEAD_TOKENS
        + removedMemoryTokens;
    const pseudoBefore = {
        ...result,
        totalTokensBefore: totalBefore,
        localSkills: [
            ...result.localSkills,
            ...removedSkillEntries.map((e) => ({
                name: e.name,
                path: e.from,
                sizeBytes: 0,
                tokens: e.tokenCount || 0,
                source: 'local',
            })),
        ],
    };
    const reportData = calculateReport(pseudoBefore, result, movedEntries, sessionsPerDay);
    console.log('');
    console.log(formatReportBox(reportData));
    console.log('');
    await flushCache();
});
// --- default (no subcommand) → run clean ---
program.action(async () => {
    await runCleanPipeline({ dryRun: false, auto: false, sessionsPerDay: 2, lookbackDays: 60 });
});
// --- shared clean pipeline ---
async function runCleanPipeline(opts) {
    await initTokenizer();
    const result = await scan({ lookbackDays: opts.lookbackDays });
    if (result.issues.length === 0) {
        console.log('\n  \x1b[32mAlready slim!\x1b[0m No issues found.\n');
        await flushCache();
        return;
    }
    console.log(formatScanSummary(result));
    const isInteractive = !opts.auto && process.stdin.isTTY;
    let selectedIssues;
    if (isInteractive) {
        console.log('  Actions:');
        console.log('    Enter    \u2192 accept pre-selected (Tier 1 only)');
        console.log('    1,3,5    \u2192 select specific items');
        console.log('    all      \u2192 select everything');
        console.log('    none     \u2192 cancel');
        console.log('');
        const selection = await askUser('  Your choice: ');
        selectedIssues = resolveSelection(selection, result.issues);
    }
    else {
        // Auto mode or non-TTY: select Tier 1 only
        selectedIssues = result.issues.filter((i) => i.tier === 1);
        if (!opts.auto) {
            console.log('  \x1b[33m\u26a0 Non-interactive mode detected, auto-selecting Tier 1\x1b[0m\n');
        }
        else {
            console.log(`  \x1b[36m\u2192 Auto mode: selecting ${selectedIssues.length} Tier 1 item(s)\x1b[0m\n`);
        }
    }
    if (selectedIssues.length === 0) {
        console.log('\n  Cancelled. No changes made.\n');
        await flushCache();
        return;
    }
    if (opts.dryRun) {
        console.log('\n  \x1b[33m[DRY RUN]\x1b[0m Would disable:');
        for (const issue of selectedIssues) {
            console.log(`    \u2022 ${issue.name} (${issue.type})`);
        }
        console.log(`\n  Estimated token savings: ~${selectedIssues.reduce((s, i) => s + i.tokens, 0).toLocaleString()}`);
        console.log('');
        await flushCache();
        return;
    }
    console.log('');
    const cleanResult = await cleanIssues(selectedIssues);
    // Re-scan after cleanup for accurate breakdown
    const afterResult = await scan({ lookbackDays: opts.lookbackDays });
    const reportData = calculateReport(result, afterResult, cleanResult.moved, opts.sessionsPerDay);
    console.log('');
    console.log(formatReportBox(reportData));
    console.log('');
    if (cleanResult.errors.length > 0) {
        console.log('  \x1b[31mErrors:\x1b[0m');
        for (const err of cleanResult.errors) {
            console.log(`    \u2022 ${err.name}: ${err.error}`);
        }
        console.log('');
    }
    console.log(`  Recovery: ~/.claude/skills.disabled/`);
    console.log(`  Restore:  npx claude-slim restore\n`);
    await flushCache();
}
// --- helpers ---
function askUser(prompt) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}
program.parse();
