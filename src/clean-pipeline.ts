import { createInterface } from 'node:readline';
import { initTokenizer, flushCache } from './tokenizer.js';
import { scan } from './scanner.js';
import { cleanIssues } from './cleaner.js';
import { formatScanSummary, formatReportBox, calculateReport } from './report.js';
import { looksLikeToolInstallDir, projectDirError, getDisabledDir } from './paths.js';
import { scanCodex } from './codex/index.js';
import { classifyCodexIssues } from './codex/detectors.js';
import { resolveSelection, parseSelection } from './selection.js';
import type { Issue } from './types.js';

// The clean pipeline and the prompt helpers it shares with other commands.
// Kept out of cli.ts, which parses argv on import, so tests can drive it.

/**
 * Name the fragments of a selection that were thrown away.
 *
 * Silence here is dangerous in one direction only: the user believes they
 * selected more than they did, sees a short confirmation, and assumes the rest
 * is coming. Keywords (`all`, `none`, empty) are handled by the resolvers and
 * are not fragments, so they are not reported as invalid.
 */
export function warnIgnoredSelection(input: string, count: number): void {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === '' || ['all', 'a', 'none', 'n', 'enter'].includes(trimmed)) return;
  const { invalid } = parseSelection(trimmed, count);
  if (invalid.length === 0) return;
  console.log(
    `  \x1b[33m!\x1b[0m Ignored ${invalid.length} unrecognised entr${invalid.length === 1 ? 'y' : 'ies'}: ` +
    `${invalid.join(', ')}  \x1b[90m(valid: 1-${count}, e.g. "3", "5-12")\x1b[0m`,
  );
}

/**
 * Resolve which directory's project memory counts toward the startup estimate.
 *
 * Warns when the CLI is running from its own install directory and no explicit
 * directory was given: the slug would resolve to the plugin cache, match no
 * project, and silently zero out every project-memory token. Warning beats
 * guessing — we cannot know which project the user meant.
 *
 * A `--project-dir` that does not exist is a hard error rather than a warning.
 * The slug is derived from the path string, so a typo happily resolves to a
 * slug that matches nothing and reports 0 — reintroducing, through the very
 * flag added to prevent it, the silent zero of v2.12.1. An explicit flag with a
 * bad value is unambiguously a mistake, so fail instead of guessing.
 */
export function resolveProjectDir(explicit?: string): string | undefined {
  if (explicit) {
    const err = projectDirError(explicit);
    if (err) {
      // Exit rather than fall back to cwd: continuing would print a full,
      // confident report built on the wrong project.
      console.error(`error: ${err}`);
      process.exit(1);
    }
    return explicit;
  }
  if (looksLikeToolInstallDir()) {
    console.error(
      '  \x1b[33m!\x1b[0m Running from claude-slim\'s own install directory, so project memory\n' +
      '    cannot be attributed and is reported as 0. Pass --project-dir <path>\n' +
      '    (or run from your project) for an accurate startup total.\n',
    );
  }
  return undefined;
}

// --- shared clean pipeline ---

export async function runCleanPipeline(opts: {
  dryRun: boolean;
  auto: boolean;
  sessionsPerDay: number;
  lookbackDays: number;
  /** false skips ~/.codex entirely. */
  codex: boolean;
  /** Directory whose project memory counts; defaults to cwd. */
  projectDir?: string;
}): Promise<void> {
  await initTokenizer();
  // Resolved once: the after-clean rescan must measure the same project, or
  // the before/after pair compares two different memory totals.
  const projectDir = resolveProjectDir(opts.projectDir);
  const result = await scan({ lookbackDays: opts.lookbackDays, projectDir });

  // Codex issues join the same tiered list. They carry `agent: 'codex'`, which
  // is what keeps the cleaner's path guard pointed at ~/.codex/.
  const codexContents = new Map<string, string>();
  const codexScan = opts.codex ? await scanCodex(codexContents) : null;
  if (codexScan) {
    result.issues.push(...(await classifyCodexIssues({ scan: codexScan, contents: codexContents })));
    result.issues.sort((a, b) => a.tier - b.tier || b.tokens - a.tokens);
  }

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
    console.log('    Enter    → accept pre-selected (Tier 1 only)');
    console.log('    1,3,5    → select specific items');
    console.log('    1-9      → select a range');
    console.log('    all      → select everything');
    console.log('    none     → cancel');
    console.log('');

    const selection = await askUser('  Your choice: ');
    warnIgnoredSelection(selection, result.issues.length);
    selectedIssues = resolveSelection(selection, result.issues);
  } else if (opts.auto) {
    // Explicit non-interactive mode: select Tier 1 only.
    selectedIssues = result.issues.filter((i) => i.tier === 1);
    console.log(`  \x1b[36m→ Auto mode: selecting ${selectedIssues.length} Tier 1 item(s)\x1b[0m\n`);
  } else if (opts.dryRun) {
    // A dry run writes nothing, so there is nothing to refuse. Preview the
    // default selection (Tier 1, what Enter or --auto would take) — this is
    // how the skill runs it, from a Bash tool with no TTY.
    selectedIssues = result.issues.filter((i) => i.tier === 1);
    const optIn = result.issues.length - selectedIssues.length;
    console.log(
      `  \x1b[36m→ Non-interactive dry run: previewing the ${selectedIssues.length} Tier 1 item(s) selected by default` +
      (optIn > 0 ? `; ${optIn} Tier 2/3 item(s) need an explicit selection` : '') +
      '\x1b[0m',
    );
    if (selectedIssues.length === 0) {
      console.log('\n  \x1b[33m[DRY RUN]\x1b[0m Nothing is selected by default. No changes made.\n');
      await flushCache();
      return;
    }
  } else {
    // Non-TTY without --auto/--dry-run: refuse rather than silently mutating
    // the filesystem. Prior behavior auto-selected Tier 1, which surprised
    // users who ran the CLI from scripts/nohup expecting a no-op.
    console.log(
      '\n  \x1b[33m⚠ Non-interactive shell detected.\x1b[0m ' +
      'Re-run with \x1b[1m--auto\x1b[0m (apply Tier 1) or \x1b[1m--dry-run\x1b[0m (preview only).\n',
    );
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
  const afterResult = await scan({ lookbackDays: opts.lookbackDays, projectDir });

  const reportData = calculateReport(result, afterResult, cleanResult.moved, opts.sessionsPerDay);
  console.log('');
  console.log(formatReportBox(reportData));
  console.log('');

  if (cleanResult.claudeCliMissing) {
    const skippedPluginCount = selectedIssues.filter((i) => i.type === 'unused_plugin').length;
    const skippedMcpCount = selectedIssues.filter((i) => i.type === 'unused_mcp').length;
    console.log(
      `  \x1b[33m⚠ \`claude\` CLI not found on PATH — skipped ${skippedPluginCount} plugin(s) and ${skippedMcpCount} MCP server(s).\x1b[0m`,
    );
    console.log(
      '    Install Claude Code and re-run, or remove them manually with',
    );
    console.log(
      '    `claude plugin disable <name>` / `claude mcp remove -s <scope> <name>`.\n',
    );
  }

  if (cleanResult.errors.length > 0) {
    console.log('  \x1b[31mErrors:\x1b[0m');
    for (const err of cleanResult.errors) {
      console.log(`    • ${err.name}: ${err.error}`);
    }
    console.log('');
  }

  console.log(`  Recovery: ${getDisabledDir()}`);
  console.log(`  Restore:  npx claude-slim restore\n`);

  await flushCache();
}

// --- helpers ---

export function askUser(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
