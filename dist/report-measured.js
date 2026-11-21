const BOLD = '\x1b[1m';
const DIM = '\x1b[90m';
const WARN = '\x1b[33m';
const RESET = '\x1b[0m';
const MAX_GROUP_ROWS = 6;
const MAX_NAMES = 4;
const MAX_COLLISIONS = 3;
const tok = (n) => `${n.toLocaleString().padStart(8)} tok`;
const row = (label, tokens, note) => `    ${label.padEnd(30)}${tok(tokens)}   ${DIM}${note}${RESET}`;
function shortName(c) {
    const i = c.name.lastIndexOf(':');
    const base = i === -1 ? c.name : c.name.slice(i + 1);
    return c.flaggedUnused ? `${base} (unused)` : base;
}
function groupCollapsed(collapsed) {
    const groups = new Map();
    for (const c of collapsed) {
        const label = c.source === 'plugin' ? `plugin ${c.plugin ?? '?'}` :
            c.source === 'local' ? 'local' :
                c.source === 'synced' ? 'claude.ai synced' :
                    c.name.includes(':') ? `plugin ${c.name.slice(0, c.name.indexOf(':'))}` : 'other';
        groups.set(label, [...(groups.get(label) ?? []), c]);
    }
    return [...groups.entries()]
        .map(([label, items]) => ({ label, items }))
        .sort((a, b) => b.items.length - a.items.length);
}
export function formatMeasuredSection(result) {
    const m = result.measuredStartup;
    const v = result.listingVisibility;
    if (!m || !v)
        return [];
    const lines = [''];
    const where = m.fromOtherProject ? 'another project' : 'this project';
    const meta = [v.sessionDate, v.claudeCodeVersion && `Claude Code ${v.claudeCodeVersion}`, where]
        .filter(Boolean)
        .join(' · ');
    lines.push(`${BOLD}  MEASURED AT SESSION START${RESET} ${DIM}(newest session log: ${meta})${RESET}`);
    if (m.firstTurnInputTokens) {
        lines.push(row('First turn, all included', m.firstTurnInputTokens, "Claude Code's own prompt + tools + your setup"));
    }
    lines.push(row('Skill listing', v.listingTokens, `${v.listingWidth.toLocaleString()} / ${v.budgetChars.toLocaleString()} columns budget · ${v.skillCount} skills`));
    const d = m.deferredTools;
    if (d && d.count > 0) {
        const top = d.servers
            .filter((s) => s.server !== '(built-in)')
            .slice(0, 3)
            .map((s) => `${s.server} ${s.tools}`)
            .join(', ');
        lines.push(row('Tool names (deferred)', d.tokens, `${d.count} tools${top ? ` · most: ${top}` : ''}`));
    }
    if (m.mcpInstructions && m.mcpInstructions.servers.length > 0) {
        lines.push(row('MCP server instructions', m.mcpInstructions.tokens, `${m.mcpInstructions.servers.length} servers`));
    }
    if (m.agentListing && m.agentListing.count > 0) {
        lines.push(row('Agent catalog', m.agentListing.tokens, `${m.agentListing.count} agents`));
    }
    if (m.instructions && m.instructions.files.length > 0) {
        const t = m.instructions.files.reduce((s, f) => s + f.tokens, 0);
        lines.push(row('Instruction files', t, `${m.instructions.files.length} files (CLAUDE.md, rules, memory index)`));
    }
    if (v.collapsed.length > 0) {
        lines.push('');
        lines.push(`  ${WARN}!${RESET} ${BOLD}${v.collapsed.length} of ${v.skillCount} skills are listed by name only${RESET} — ` +
            `Claude can't see what they do, so it rarely picks them`);
        const groups = groupCollapsed(v.collapsed);
        for (const g of groups.slice(0, MAX_GROUP_ROWS)) {
            const names = g.items.slice(0, MAX_NAMES).map(shortName).join(', ');
            const more = g.items.length > MAX_NAMES ? ', …' : '';
            lines.push(`      ${g.label.padEnd(28)}${String(g.items.length).padStart(4)}   ${DIM}${names}${more}${RESET}`);
        }
        if (groups.length > MAX_GROUP_ROWS) {
            const rest = groups.slice(MAX_GROUP_ROWS).reduce((s, g) => s + g.items.length, 0);
            lines.push(`      ${DIM}… ${rest} more in ${groups.length - MAX_GROUP_ROWS} other groups (full list: --json)${RESET}`);
        }
        if (v.restoredIfFlaggedCleaned > 0) {
            lines.push(`    Cleaning the skills flagged unused below would bring back ~${v.restoredIfFlaggedCleaned} descriptions.`);
        }
        if (v.nameOnlyByChoice > 0) {
            lines.push(`    ${DIM}(${v.nameOnlyByChoice} more are name-only by your skillOverrides — not counted here)${RESET}`);
        }
        lines.push(`    ${DIM}Also: set skills you only call by hand to "name-only" in skillOverrides, ` +
            `or raise skillListingBudgetFraction.${RESET}`);
    }
    if (d) {
        const dupTools = new Set();
        const perChar = d.chars > 0 ? d.tokens / d.chars : 0;
        for (const dup of d.duplicateServers) {
            lines.push(`  ${WARN}!${RESET} ${dup.servers[0]} and ${dup.servers[1]} expose the same ${dup.shared} tools — ` +
                `likely one connector added twice (~${Math.round(dup.chars * perChar).toLocaleString()} tok of names)`);
            dup.servers.forEach((s) => dupTools.add(s));
        }
        const loose = d.collisions.filter((c) => !c.servers.every((s) => dupTools.has(s)));
        for (const c of loose.slice(0, MAX_COLLISIONS)) {
            lines.push(`  ${WARN}!${RESET} tool name ${c.tool} is exposed by ${c.servers.join(' and ')} — Claude may call the wrong one`);
        }
        if (loose.length > MAX_COLLISIONS) {
            lines.push(`    ${DIM}… ${loose.length - MAX_COLLISIONS} more tool-name collisions (--json)${RESET}`);
        }
    }
    return lines;
}
