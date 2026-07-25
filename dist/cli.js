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
import { checkForUpdate, formatUpdateNotice } from './update-check.js';
import { resolveSelection, resolveRestoreSelection } from './selection.js';
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const { version: PKG_VERSION } = JSON.parse(readFileSync(pkgPath, 'utf-8'));
// Parse a non-negative-integer CLI option, keeping explicit 0 distinct from an
// unset/invalid value. `parseInt(x, 10) || N` was swallowing legitimate 0
// (e.g. `--lookback-days 0` was silently upgraded to 60).
function parseNonNegativeInt(raw, fallback) {
    if (typeof raw !== 'string')
        return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0)
        return fallback;
    return n;
}
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
    const result = await scan({ lookbackDays: parseNonNegativeInt(opts.lookbackDays, 60) });
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
    .option('--offline', 'Skip the npm version check (no outbound request)')
    .action(async (opts) => {
    const report = await collectDoctorReport({
        lookbackDays: parseNonNegativeInt(opts.lookbackDays, 60),
        checkUpdate: !opts.offline,
    });
    if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
    }
    else {
        console.log(formatDoctorReport(report));
    }
});
// --- check-update ---
// Detection only. Updating is the package manager's job — claude-slim writing
// into a directory `claude plugin` owns is how installs get corrupted.
program
    .command('check-update')
    .description('Check whether a newer claude-slim is published (no changes made)')
    .option('--json', 'Output raw JSON')
    .option('--force', 'Ignore the 24h cache and re-query the registry')
    .action(async (opts) => {
    const result = await checkForUpdate({ force: Boolean(opts.force) });
    if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    const notice = formatUpdateNotice(result);
    if (notice) {
        console.log(`\n  \x1b[33m${notice}\x1b[0m\n`);
    }
    else if (result.latest === null) {
        console.log(`\n  Could not reach the npm registry. Installed: ${result.installed}\n`);
    }
    else {
        console.log(`\n  \x1b[32m✓\x1b[0m claude-slim ${result.installed} is up to date.\n`);
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
        sessionsPerDay: parseNonNegativeInt(opts.sessionsPerDay, 2),
        lookbackDays: parseNonNegativeInt(opts.lookbackDays, 60),
    });
});
// --- restore ---
program
    .command('restore')
    .description('Restore previously disabled items')
    .action(async () => {
    const allEntries = await readManifest();
    // Separate plugin entries (DisabledPluginEntry shape) from legacy ManifestEntry
    const pluginEntries = allEntries.filter((e) => 'plugin' in e && 'marketplace' in e);
    const legacyEntries = allEntries.filter((e) => !('plugin' in e && 'marketplace' in e));
    // v2 manifest contains only currently-disabled entries (restored ones are removed)
    const disabled = legacyEntries.filter((e) => e.type !== 'broken_symlink');
    const NON_RESTORABLE = new Set(['temp_cache', 'disabled_plugin']);
    const restorableLegacy = disabled.filter((e) => !NON_RESTORABLE.has(e.type));
    const infoOnly = disabled.filter((e) => NON_RESTORABLE.has(e.type));
    // Combine restorable: legacy skill/project entries + plugin entries
    const restorable = [...restorableLegacy, ...pluginEntries];
    if (restorable.length === 0 && infoOnly.length === 0) {
        console.log('\n  Nothing to restore.\n');
        return;
    }
    if (restorable.length > 0) {
        console.log('\n  Restorable items:\n');
        for (let i = 0; i < restorable.length; i++) {
            const e = restorable[i];
            if ('plugin' in e && 'marketplace' in e) {
                const pe = e;
                const date = new Date(pe.disabledAt).toLocaleDateString();
                console.log(`    ${i + 1}. [plugin] ${pe.plugin} @ ${pe.marketplace} (disabled ${date})`);
            }
            else {
                const le = e;
                const date = new Date(le.date).toLocaleDateString();
                console.log(`    ${i + 1}. ${le.name} (${le.type}, disabled ${date})`);
            }
        }
    }
    if (infoOnly.length > 0) {
        console.log('\n  \x1b[90mNon-restorable (for reference):\x1b[0m');
        for (const e of infoOnly) {
            const date = new Date(e.date).toLocaleDateString();
            const hint = e.type === 'disabled_plugin'
                ? `reinstall: claude plugin install ${e.name}`
                : 'deleted, cannot restore';
            console.log(`    \x1b[90m• ${e.name} (${date}) — ${hint}\x1b[0m`);
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
        const e = restorable[idx];
        const label = 'plugin' in e && 'marketplace' in e
            ? e.plugin
            : e.name;
        try {
            await restoreItem(e);
            console.log(`  \x1b[32m✓\x1b[0m Restored: ${label}`);
            restored++;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`  \x1b[31m✗\x1b[0m ${label}: ${msg}`);
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
    const result = await scan({ lookbackDays: parseNonNegativeInt(opts.lookbackDays, 60) });
    const allEntries = await readManifest();
    // Filter to legacy-style entries only (those with tokenCount/name/from fields)
    const entries = allEntries.filter((e) => !('plugin' in e && 'marketplace' in e));
    // Any prior manifest entry counts as a cleanup receipt. Filtering on
    // `tokenCount > 0` previously hid runs that only removed zero-token items
    // (broken_symlink / temp_cache), making `report` say "no previous cleanup"
    // even after real work.
    const movedEntries = entries;
    if (movedEntries.length === 0) {
        console.log('\n  No previous cleanup found. Run `claude-slim clean` first.\n');
        await flushCache();
        return;
    }
    const sessionsPerDay = parseNonNegativeInt(opts.sessionsPerDay, 2);
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
                // The file is gone, so its real listing cost is unrecoverable. Fall
                // back to the flat estimate — the same one `totalBefore` above uses,
                // keeping the reconstructed before-state internally consistent.
                listingTokens: SKILL_PROMPT_OVERHEAD_TOKENS,
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
        console.log('    Enter    → accept pre-selected (Tier 1 only)');
        console.log('    1,3,5    → select specific items');
        console.log('    all      → select everything');
        console.log('    none     → cancel');
        console.log('');
        const selection = await askUser('  Your choice: ');
        selectedIssues = resolveSelection(selection, result.issues);
    }
    else if (opts.auto) {
        // Explicit non-interactive mode: select Tier 1 only.
        selectedIssues = result.issues.filter((i) => i.tier === 1);
        console.log(`  \x1b[36m→ Auto mode: selecting ${selectedIssues.length} Tier 1 item(s)\x1b[0m\n`);
    }
    else {
        // Non-TTY without --auto/--dry-run: refuse rather than silently mutating
        // the filesystem. Prior behavior auto-selected Tier 1, which surprised
        // users who ran the CLI from scripts/nohup expecting a no-op.
        console.log('\n  \x1b[33m⚠ Non-interactive shell detected.\x1b[0m ' +
            'Re-run with \x1b[1m--auto\x1b[0m (apply Tier 1) or \x1b[1m--dry-run\x1b[0m (preview only).\n');
        await flushCache();
        process.exitCode = 1;
        return;
    }
    if (selectedIssues.length === 0) {
        console.log('\n  Cancelled. No changes made.\n');
        await flushCache();
        return;
    }
    if (opts.dryRun) {
        console.log('\n  \x1b[33m[DRY RUN]\x1b[0m Would disable:');
        for (const issue of selectedIssues) {
            console.log(`    • ${issue.name} (${issue.type})`);
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
    if (cleanResult.claudeCliMissing) {
        const skippedPluginCount = selectedIssues.filter((i) => i.type === 'unused_plugin').length;
        console.log(`  \x1b[33m⚠ \`claude\` CLI not found on PATH — skipped ${skippedPluginCount} plugin(s).\x1b[0m`);
        console.log('    Install Claude Code and re-run to disable unused plugins,');
        console.log('    or disable them manually via `claude plugin disable <name>`.\n');
    }
    if (cleanResult.errors.length > 0) {
        console.log('  \x1b[31mErrors:\x1b[0m');
        for (const err of cleanResult.errors) {
            console.log(`    • ${err.name}: ${err.error}`);
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
