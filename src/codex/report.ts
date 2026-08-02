import type { CodexScanResult } from './index.js';

const TOP_N = 5;

/**
 * Render the Codex section appended to `scan` output.
 *
 * Deliberately reports only what Codex can actually tell us. The "not
 * available" line for unused-skill detection is not an apology — stating the
 * limit is what keeps the tool from inventing a signal it does not have.
 */
export function formatCodexSummary(result: CodexScanResult): string {
  const lines: string[] = [];
  const local = result.skills.filter((s) => s.source === 'local');
  const plugin = result.skills.filter((s) => s.source === 'plugin');
  const sum = (xs: Array<{ listingTokens: number }>): number =>
    xs.reduce((acc, x) => acc + x.listingTokens, 0);

  lines.push('');
  lines.push('\x1b[1m=== codex ===\x1b[0m');
  lines.push('');
  lines.push(`  \x1b[90m${result.root}\x1b[0m`);
  lines.push('');

  const row = (label: string, count: string, tokens: number): string =>
    `    ${label.padEnd(24)} ${count.padStart(8)}  ${tokens.toLocaleString().padStart(8)} tok`;

  lines.push('\x1b[1m  STARTUP COST\x1b[0m');
  lines.push(row('Local skills', `${local.length}`, sum(local)));
  lines.push(row('Plugin skills', `${plugin.length}`, sum(plugin)));
  lines.push(row('Agents', `${result.agents.length}`, sum(result.agents)));
  lines.push(
    row('AGENTS.md', `${(result.instructionsBytes / 1024).toFixed(1)}KB`, result.instructionsTokens),
  );
  lines.push(`    ${'─'.repeat(46)}`);
  lines.push(row('Total', '', result.totalTokens));

  const heaviest = [...result.skills].sort((a, b) => b.listingTokens - a.listingTokens).slice(0, TOP_N);
  if (heaviest.length > 0) {
    lines.push('');
    lines.push(`\x1b[1m  HEAVIEST LISTINGS\x1b[0m (top ${heaviest.length})`);
    for (const s of heaviest) {
      const origin = s.pluginName ? `plugin:${s.pluginName}` : 'local';
      // Names can exceed the column (backup copies like `foo.bak.20260711`);
      // truncate so the token column stays aligned.
      const name = s.name.length > 30 ? `${s.name.slice(0, 29)}…` : s.name;
      lines.push(
        `    ${name.padEnd(30)} ${String(s.listingTokens).padStart(5)} tok  \x1b[90m${origin}\x1b[0m`,
      );
    }
  }

  lines.push('');
  lines.push(`  \x1b[33m!\x1b[0m Unused-skill detection unavailable for Codex.`);
  lines.push(`    \x1b[90m${result.unusedDetectionReason}\x1b[0m`);
  lines.push('');
  lines.push(`  \x1b[90mReported only — claude-slim never modifies ~/.codex/.\x1b[0m`);
  lines.push('');

  return lines.join('\n');
}
