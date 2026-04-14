import { isUsingFallback } from './tokenizer.js';
const SESSIONS_PER_DAY_DEFAULT = 2;
const PRICE_PER_1K_TOKENS = 0.003; // Claude Sonnet input price
export function calculateReport(scanBefore, scanAfter, movedEntries, sessionsPerDay = SESSIONS_PER_DAY_DEFAULT) {
    const savedTokens = movedEntries.reduce((sum, e) => sum + (e.tokenCount || 0), 0);
    const before = scanBefore.totalTokensBefore;
    const after = scanAfter ? scanAfter.totalTokensBefore : before - savedTokens;
    const percent = before > 0 ? (savedTokens / before) * 100 : 0;
    const topOffenders = movedEntries
        .filter((e) => (e.tokenCount || 0) > 0)
        .sort((a, b) => (b.tokenCount || 0) - (a.tokenCount || 0))
        .slice(0, 5)
        .map((e) => ({ name: e.name, tokens: e.tokenCount || 0 }));
    const monthlySavings = (savedTokens / 1000) * PRICE_PER_1K_TOKENS * sessionsPerDay * 30;
    // Breakdown rows
    const localBefore = scanBefore.localSkills.length;
    const localAfter = scanAfter ? scanAfter.localSkills.length : localBefore - movedEntries.filter((e) => e.type !== 'oversized_memory').length;
    const promptBefore = scanBefore.localSkills.length + scanBefore.pluginSkills.length;
    const promptAfter = scanAfter
        ? scanAfter.localSkills.length + scanAfter.pluginSkills.length
        : promptBefore - movedEntries.filter((e) => e.type !== 'oversized_memory').length;
    const memBefore = scanBefore.memoryFiles.reduce((s, m) => s + m.sizeBytes, 0);
    const memAfter = scanAfter
        ? scanAfter.memoryFiles.reduce((s, m) => s + m.sizeBytes, 0)
        : memBefore;
    const breakdown = [
        {
            label: 'Local skills',
            before: String(localBefore),
            after: String(localAfter),
            saved: `${localAfter - localBefore}`,
        },
        {
            label: 'System prompt',
            before: `~${promptBefore}`,
            after: `~${promptAfter}`,
            saved: `${promptAfter - promptBefore}`,
        },
        {
            label: 'Memory files',
            before: `${(memBefore / 1024).toFixed(1)}KB`,
            after: `${(memAfter / 1024).toFixed(1)}KB`,
            saved: `${((memAfter - memBefore) / 1024).toFixed(1)}KB`,
        },
        {
            label: 'Est. tokens',
            before: `~${before.toLocaleString()}`,
            after: `~${after.toLocaleString()}`,
            saved: `~${(after - before).toLocaleString()}`,
        },
    ];
    return {
        before,
        after,
        saved: savedTokens,
        percent,
        topOffenders,
        monthlySavings,
        sessionsPerDay,
        breakdown,
    };
}
export function formatReportBox(data) {
    const lines = [];
    const W = 42;
    const pad = (s) => {
        const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
        return s + ' '.repeat(Math.max(0, W - 2 - visible.length));
    };
    const top = '\u256d' + '\u2500'.repeat(W) + '\u256e';
    const bot = '\u2570' + '\u2500'.repeat(W) + '\u256f';
    const blank = '\u2502' + ' '.repeat(W) + '\u2502';
    lines.push(top);
    lines.push(`\u2502${pad('  claude-slim report')}\u2502`);
    lines.push(blank);
    lines.push(`\u2502${pad(`  Before: ${data.before.toLocaleString()} tokens at startup`)}\u2502`);
    lines.push(`\u2502${pad(`  After:  ${data.after.toLocaleString()} tokens at startup`)}\u2502`);
    lines.push(`\u2502${pad(`  Saved:  ${data.saved.toLocaleString()} tokens (${data.percent.toFixed(1)}%)`)}\u2502`);
    lines.push(blank);
    if (data.topOffenders.length > 0) {
        lines.push(`\u2502${pad('  Top offenders removed:')}\u2502`);
        for (const item of data.topOffenders) {
            const tokStr = item.tokens.toLocaleString() + ' tok';
            const nameStr = `  \u2022 ${item.name}`;
            const gap = Math.max(1, W - 2 - nameStr.length - tokStr.length);
            lines.push(`\u2502${nameStr}${' '.repeat(gap)}${tokStr}\u2502`);
        }
        lines.push(blank);
    }
    const savingsStr = `$${data.monthlySavings.toFixed(2)}`;
    lines.push(`\u2502${pad(`  Est. monthly savings: ~${savingsStr}`)}\u2502`);
    lines.push(`\u2502${pad(`  (${data.sessionsPerDay} sessions/day \u00d7 $${PRICE_PER_1K_TOKENS}/1K tok)`)}\u2502`);
    if (isUsingFallback()) {
        lines.push(blank);
        lines.push(`\u2502${pad('  \u26a0 Token counts are approximations (bytes/4)')}\u2502`);
    }
    lines.push(bot);
    // Breakdown table
    if (data.breakdown.length > 0) {
        lines.push('');
        lines.push(formatBreakdownTable(data.breakdown));
    }
    return lines.join('\n');
}
function formatBreakdownTable(rows) {
    const cols = [18, 10, 10, 12];
    const hr = '\u2500';
    const lines = [];
    const cell = (s, w, align = 'center') => {
        const pad = Math.max(0, w - s.length);
        if (align === 'center') {
            const l = Math.floor(pad / 2);
            return ' '.repeat(l) + s + ' '.repeat(pad - l);
        }
        return ' ' + s + ' '.repeat(pad - 1);
    };
    lines.push(`  \u250c${hr.repeat(cols[0])}\u252c${hr.repeat(cols[1])}\u252c${hr.repeat(cols[2])}\u252c${hr.repeat(cols[3])}\u2510`);
    lines.push(`  \u2502${cell('', cols[0])}\u2502${cell('Before', cols[1])}\u2502${cell('After', cols[2])}\u2502${cell('Saved', cols[3])}\u2502`);
    lines.push(`  \u251c${hr.repeat(cols[0])}\u253c${hr.repeat(cols[1])}\u253c${hr.repeat(cols[2])}\u253c${hr.repeat(cols[3])}\u2524`);
    for (const row of rows) {
        lines.push(`  \u2502${cell(row.label, cols[0], 'left')}\u2502${cell(row.before, cols[1])}\u2502${cell(row.after, cols[2])}\u2502${cell(row.saved, cols[3])}\u2502`);
    }
    lines.push(`  \u2514${hr.repeat(cols[0])}\u2534${hr.repeat(cols[1])}\u2534${hr.repeat(cols[2])}\u2534${hr.repeat(cols[3])}\u2518`);
    return lines.join('\n');
}
export function formatScanSummary(result) {
    const lines = [];
    lines.push('');
    lines.push('\x1b[1mclaude-slim scan\x1b[0m');
    lines.push('');
    // Snapshot
    lines.push(`  Local skills:     ${result.localSkills.length}`);
    lines.push(`  Plugin skills:    ${result.pluginSkills.length}`);
    lines.push(`  Plugins:          ${result.plugins.length}`);
    lines.push(`  CLAUDE.md:        ${(result.claudeMdBytes / 1024).toFixed(1)}KB (${result.claudeMdTokens.toLocaleString()} tok)`);
    lines.push(`  Memory files:     ${result.memoryFiles.length} (${(result.memoryFiles.reduce((s, m) => s + m.sizeBytes, 0) / 1024).toFixed(1)}KB)`);
    lines.push(`  MCP servers:      ${result.mcpServers}`);
    lines.push(`  Est. overhead:    ~${result.totalTokensBefore.toLocaleString()} tokens`);
    if (isUsingFallback()) {
        lines.push(`  \x1b[33m\u26a0 Using bytes/4 approximation (js-tiktoken unavailable)\x1b[0m`);
    }
    lines.push('');
    if (result.issues.length === 0) {
        lines.push('  \x1b[32mAlready slim!\x1b[0m No issues found.');
    }
    else {
        lines.push(`  \x1b[1mFound ${result.issues.length} issues:\x1b[0m`);
        lines.push('');
        const tierLabels = { 1: 'Auto', 2: 'Recommended', 3: 'Optional' };
        const tierColors = { 1: '31', 2: '33', 3: '37' };
        for (let i = 0; i < result.issues.length; i++) {
            const issue = result.issues[i];
            const selected = issue.tier === 1 ? '\u2713' : '\u25cb';
            const tierLabel = tierLabels[issue.tier] || 'Unknown';
            const color = tierColors[issue.tier] || '37';
            const detail = issue.detail ? ` (${issue.detail})` : '';
            const tokStr = issue.tokens > 0 ? ` ~${issue.tokens.toLocaleString()} tok` : '';
            lines.push(`  ${selected} ${i + 1}. \x1b[${color}m[${tierLabel}]\x1b[0m ${issue.type}: ${issue.name}${detail}${tokStr}`);
        }
    }
    lines.push('');
    return lines.join('\n');
}
