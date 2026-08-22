const TOP_N = 5;
/**
 * Render the Codex section appended to `scan` output.
 *
 * Deliberately reports only what Codex can actually tell us. The "not
 * available" line for unused-skill detection is not an apology — stating the
 * limit is what keeps the tool from inventing a signal it does not have.
 */
export function formatCodexSummary(result) {
    const lines = [];
    const local = result.skills.filter((s) => s.source === 'local');
    const plugin = result.skills.filter((s) => s.source === 'plugin');
    const sum = (xs) => xs.reduce((acc, x) => acc + x.listingTokens, 0);
    lines.push('');
    lines.push('\x1b[1m=== codex ===\x1b[0m');
    lines.push('');
    lines.push(`  \x1b[90m${result.root}\x1b[0m`);
    lines.push('');
    const row = (label, count, tokens) => `    ${label.padEnd(24)} ${count.padStart(8)}  ${tokens.toLocaleString().padStart(8)} tok`;
    lines.push('\x1b[1m  STARTUP COST\x1b[0m');
    lines.push(row('Local skills', `${local.length}`, sum(local)));
    lines.push(row('Plugin skills', `${plugin.length}`, sum(plugin)));
    lines.push(row('Agents', `${result.agents.length}`, sum(result.agents)));
    lines.push(row('AGENTS.md', `${(result.instructionsBytes / 1024).toFixed(1)}KB`, result.instructionsTokens));
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
            lines.push(`    ${name.padEnd(30)} ${String(s.listingTokens).padStart(5)} tok  \x1b[90m${origin}\x1b[0m`);
        }
    }
    const backups = result.skills.filter((s) => s.backupArtifact);
    if (backups.length > 0) {
        lines.push('');
        lines.push(`\x1b[1m  LIKELY BACKUP COPIES\x1b[0m (${backups.length})`);
        for (const b of backups) {
            lines.push(`    ${b.name.length > 30 ? `${b.name.slice(0, 29)}…` : b.name.padEnd(30)} ` +
                `${String(b.listingTokens).padStart(5)} tok  \x1b[90m${b.backupArtifact}\x1b[0m`);
        }
        lines.push(`    \x1b[90mOffered by clean as Tier 2 — moved to ~/.codex/skills.disabled/, reversible with restore.\x1b[0m`);
    }
    lines.push('');
    lines.push(`  \x1b[33m!\x1b[0m Unused-skill detection unavailable for Codex.`);
    lines.push(`    \x1b[90m${result.unusedDetectionReason}\x1b[0m`);
    lines.push('');
    lines.push(`  \x1b[90mscan only reads. Since v2.11 clean also acts here, under the same tiers as ~/.claude/:\x1b[0m`);
    lines.push(`  \x1b[90mmoves go to ~/.codex/skills.disabled/ and reverse with restore, but Tier 1 install\x1b[0m`);
    lines.push(`  \x1b[90mleftovers (~/.codex/.tmp) are deleted permanently, and --auto applies Tier 1 unprompted.\x1b[0m`);
    lines.push('');
    return lines.join('\n');
}
