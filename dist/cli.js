#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { Command } from 'commander';
import { initTokenizer, flushCache } from './tokenizer.js';
import { scan } from './scanner.js';
import { cleanIssues, restoreItem } from './cleaner.js';
import { readManifest } from './manifest.js';
import { formatScanSummary, formatReportBox, calculateReport, } from './report.js';
const program = new Command();
program
    .name('claude-slim')
    .description('Analyze and reduce Claude Code token overhead')
    .version('2.0.0');
// --- scan ---
program
    .command('scan')
    .description('Scan environment and report issues')
    .option('--json', 'Output raw JSON')
    .action(async (opts) => {
    await initTokenizer();
    const result = await scan();
    await flushCache();
    if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
    }
    else {
        console.log(formatScanSummary(result));
    }
});
// --- clean ---
program
    .command('clean')
    .description('Interactive cleanup of detected issues')
    .option('--dry-run', 'Show what would happen without making changes')
    .option('--sessions-per-day <n>', 'Sessions per day for savings estimate', '2')
    .action(async (opts) => {
    await initTokenizer();
    const result = await scan();
    if (result.issues.length === 0) {
        console.log('\n  \x1b[32mAlready slim!\x1b[0m No issues found.\n');
        await flushCache();
        return;
    }
    console.log(formatScanSummary(result));
    console.log('  Actions:');
    console.log('    Enter    \u2192 accept pre-selected (Tier 1 only)');
    console.log('    1,3,5    \u2192 toggle specific items');
    console.log('    all      \u2192 select everything');
    console.log('    none     \u2192 cancel');
    console.log('');
    const selection = await askUser('  Your choice: ');
    const selectedIssues = resolveSelection(selection, result.issues);
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
    const afterResult = await scan();
    // Generate report
    const sessionsPerDay = parseInt(opts.sessionsPerDay, 10) || 2;
    const reportData = calculateReport(result, afterResult, cleanResult.moved, sessionsPerDay);
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
});
// --- restore ---
program
    .command('restore')
    .description('Restore previously disabled items')
    .action(async () => {
    const entries = await readManifest();
    const disabled = entries.filter((e) => e.action !== 'restored' && e.type !== 'broken_symlink');
    // Filter out items that were later restored
    const restoredNames = new Set(entries.filter((e) => e.action === 'restored').map((e) => e.name));
    const restorable = disabled.filter((e) => !restoredNames.has(e.name));
    if (restorable.length === 0) {
        console.log('\n  Nothing to restore.\n');
        return;
    }
    console.log('\n  Previously disabled items:\n');
    for (let i = 0; i < restorable.length; i++) {
        const e = restorable[i];
        const date = new Date(e.date).toLocaleDateString();
        console.log(`    ${i + 1}. ${e.name} (${e.type}, disabled ${date})`);
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
    .action(async (opts) => {
    await initTokenizer();
    const result = await scan();
    const entries = await readManifest();
    const movedEntries = entries.filter((e) => e.action !== 'restored' && e.tokenCount && e.tokenCount > 0);
    if (movedEntries.length === 0) {
        console.log('\n  No previous cleanup found. Run `claude-slim clean` first.\n');
        await flushCache();
        return;
    }
    const sessionsPerDay = parseInt(opts.sessionsPerDay, 10) || 2;
    // For report, "before" = current + what was removed
    const totalBefore = result.totalTokensBefore + movedEntries.reduce((s, e) => s + (e.tokenCount || 0), 0);
    const pseudoScan = { ...result, totalTokensBefore: totalBefore };
    const reportData = calculateReport(pseudoScan, result, movedEntries, sessionsPerDay);
    console.log('');
    console.log(formatReportBox(reportData));
    console.log('');
    await flushCache();
});
// --- default (no subcommand) ---
program.action(async () => {
    // Run full pipeline: scan → propose → clean → report
    program.commands.find((c) => c.name() === 'clean')?.parse(process.argv);
});
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
function resolveSelection(input, issues) {
    const trimmed = input.trim().toLowerCase();
    if (trimmed === 'none' || trimmed === 'n')
        return [];
    if (trimmed === 'all' || trimmed === 'a')
        return [...issues];
    if (trimmed === '' || trimmed === 'enter') {
        // Default: tier 1 only
        return issues.filter((i) => i.tier === 1);
    }
    // Parse comma-separated numbers
    const selected = new Set();
    for (const part of trimmed.split(',')) {
        const num = parseInt(part.trim(), 10);
        if (!isNaN(num) && num >= 1 && num <= issues.length) {
            selected.add(num - 1);
        }
    }
    // Start with tier 1, toggle the selected ones
    const result = new Set();
    for (let i = 0; i < issues.length; i++) {
        const isTier1 = issues[i].tier === 1;
        const isSelected = selected.has(i);
        if (isTier1 && !isSelected)
            result.add(i);
        else if (!isTier1 && isSelected)
            result.add(i);
        else if (isTier1 && isSelected) { /* toggled off */ }
    }
    return [...result].map((i) => issues[i]);
}
function resolveRestoreSelection(input, count) {
    const trimmed = input.trim().toLowerCase();
    if (trimmed === 'none' || trimmed === 'n' || trimmed === '')
        return [];
    if (trimmed === 'all' || trimmed === 'a') {
        return Array.from({ length: count }, (_, i) => i);
    }
    const indices = [];
    for (const part of trimmed.split(',')) {
        const num = parseInt(part.trim(), 10);
        if (!isNaN(num) && num >= 1 && num <= count) {
            indices.push(num - 1);
        }
    }
    return indices;
}
program.parse();
