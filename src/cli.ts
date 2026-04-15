#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { Command } from 'commander';
import { initTokenizer, flushCache } from './tokenizer.js';
import { scan } from './scanner.js';
import { cleanIssues, restoreItem } from './cleaner.js';
import { readManifest } from './manifest.js';
import {
  formatScanSummary,
  formatReportBox,
  calculateReport,
} from './report.js';
import type { Issue, ScanResult, ManifestEntry } from './types.js';

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
    } else {
      console.log(formatScanSummary(result));
    }
  });

// --- clean ---
program
  .command('clean')
  .description('Interactive cleanup of detected issues')
  .option('--dry-run', 'Show what would happen without making changes')
  .option('--auto', 'Non-interactive: auto-select Tier 1 items only')
  .option('--sessions-per-day <n>', 'Sessions per day for savings estimate', '2')
  .action(async (opts) => {
    await runCleanPipeline({
      dryRun: !!opts.dryRun,
      auto: !!opts.auto,
      sessionsPerDay: parseInt(opts.sessionsPerDay, 10) || 2,
    });
  });

// --- restore ---
program
  .command('restore')
  .description('Restore previously disabled items')
  .action(async () => {
    const entries = await readManifest();
    const disabled = entries.filter(
      (e) => e.action !== 'restored' && e.type !== 'broken_symlink',
    );

    // Filter out items that were later restored
    const restoredNames = new Set(
      entries.filter((e) => e.action === 'restored').map((e) => e.name),
    );
    const restorable = disabled.filter((e) => !restoredNames.has(e.name));

    if (restorable.length === 0) {
      console.log('\n  Nothing to restore.\n');
      return;
    }

    console.log('\n  Previously disabled items:\n');
    for (let i = 0; i < restorable.length; i++) {
      const e = restorable[i];
      const date = new Date(e.date).toLocaleDateString();
      const note = e.type === 'disabled_plugin'
        ? ' \x1b[33m(reinstall via: claude plugin install)\x1b[0m'
        : e.type === 'temp_cache'
          ? ' \x1b[90m(deleted, cannot restore)\x1b[0m'
          : '';
      console.log(`    ${i + 1}. ${e.name} (${e.type}, disabled ${date})${note}`);
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
      } catch (err) {
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

    const movedEntries = entries.filter(
      (e) => e.action !== 'restored' && e.tokenCount && e.tokenCount > 0,
    );

    if (movedEntries.length === 0) {
      console.log('\n  No previous cleanup found. Run `claude-slim clean` first.\n');
      await flushCache();
      return;
    }

    const sessionsPerDay = parseInt(opts.sessionsPerDay, 10) || 2;
    // Reconstruct "before" state: current + what was removed
    const removedSkillCount = movedEntries.filter((e) => e.type !== 'oversized_memory').length;
    const totalBefore = result.totalTokensBefore + removedSkillCount * 30;
    const pseudoBefore: ScanResult = {
      ...result,
      totalTokensBefore: totalBefore,
      localSkills: [
        ...result.localSkills,
        ...movedEntries
          .filter((e) => e.type !== 'oversized_memory')
          .map((e) => ({ name: e.name, path: e.from, sizeBytes: 0, tokens: e.tokenCount || 0, source: 'local' as const })),
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
  await runCleanPipeline({ dryRun: false, auto: false, sessionsPerDay: 2 });
});

// --- shared clean pipeline ---

async function runCleanPipeline(opts: { dryRun: boolean; auto: boolean; sessionsPerDay: number }): Promise<void> {
  await initTokenizer();
  const result = await scan();

  if (result.issues.length === 0) {
    console.log('\n  \x1b[32mAlready slim!\x1b[0m No issues found.\n');
    await flushCache();
    return;
  }

  console.log(formatScanSummary(result));

  const isInteractive = !opts.auto && process.stdin.isTTY;
  let selectedIssues: Issue[];

  if (isInteractive) {
    console.log('  Actions:');
    console.log('    Enter    \u2192 accept pre-selected (Tier 1 only)');
    console.log('    1,3,5    \u2192 select specific items');
    console.log('    all      \u2192 select everything');
    console.log('    none     \u2192 cancel');
    console.log('');

    const selection = await askUser('  Your choice: ');
    selectedIssues = resolveSelection(selection, result.issues);
  } else {
    // Auto mode or non-TTY: select Tier 1 only
    selectedIssues = result.issues.filter((i) => i.tier === 1);
    if (!opts.auto) {
      console.log('  \x1b[33m\u26a0 Non-interactive mode detected, auto-selecting Tier 1\x1b[0m\n');
    } else {
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
  const afterResult = await scan();

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

function askUser(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function resolveSelection(input: string, issues: Issue[]): Issue[] {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === 'none' || trimmed === 'n') return [];
  if (trimmed === 'all' || trimmed === 'a') return [...issues];

  if (trimmed === '' || trimmed === 'enter') {
    // Default: tier 1 only
    return issues.filter((i) => i.tier === 1);
  }

  // Parse comma-separated numbers → select exactly those items
  const result: Issue[] = [];
  const seen = new Set<number>();
  for (const part of trimmed.split(',')) {
    const num = parseInt(part.trim(), 10);
    if (!isNaN(num) && num >= 1 && num <= issues.length && !seen.has(num)) {
      seen.add(num);
      result.push(issues[num - 1]);
    }
  }
  return result;
}

function resolveRestoreSelection(input: string, count: number): number[] {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === 'none' || trimmed === 'n' || trimmed === '') return [];
  if (trimmed === 'all' || trimmed === 'a') {
    return Array.from({ length: count }, (_, i) => i);
  }

  const indices: number[] = [];
  for (const part of trimmed.split(',')) {
    const num = parseInt(part.trim(), 10);
    if (!isNaN(num) && num >= 1 && num <= count) {
      indices.push(num - 1);
    }
  }
  return indices;
}

program.parse();
