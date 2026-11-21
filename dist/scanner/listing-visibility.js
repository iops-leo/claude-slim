import { DEFAULT_BUDGET_FRACTION, displayWidth, listingBudgetChars, skillPriority, } from './listing-budget.js';
/** Context windows Claude Code models ship with. */
const STANDARD_WINDOWS = [200_000, 1_000_000];
/** Listing cost assumed for a skill whose SKILL.md could not be matched. */
const UNKNOWN_SKILL_TOKENS = 30;
// Claude Code budgets 4 chars/token for these model families and 3 for
// everything newer (2.1.323). Matched on the normalized model id.
const FOUR_CHAR_MODELS = [
    /^claude-3(-|$)/,
    /^claude-(opus|sonnet)-4-[0156](-|$)/,
    /^claude-haiku-4-5(-|$)/,
    /^claude-(opus|sonnet)-4(-\d{8})?$/,
];
export function bytesPerTokenForModel(model) {
    if (!model)
        return 3;
    const id = model.toLowerCase().replace(/[._]/g, '-');
    return FOUR_CHAR_MODELS.some((re) => re.test(id)) ? 4 : 3;
}
/**
 * The listing budget for the measured session. The context window is not in
 * the log, so pick the smallest standard window whose budget holds what was
 * rendered — a rendered listing never exceeds its budget. Only trustworthy as
 * an exact figure when the listing overflowed; otherwise it is a lower bound.
 */
export function inferBudgetChars(m, s) {
    const envValue = Number.parseInt(s.env ?? '', 10);
    if (Number.isFinite(envValue) && envValue > 0)
        return { chars: envValue, basis: 'env' };
    const bytesPerToken = bytesPerTokenForModel(m.model);
    const rendered = m.skillListing?.width ?? m.skillListing?.chars ?? 0;
    const candidates = STANDARD_WINDOWS.map((w) => listingBudgetChars({ contextWindowTokens: w, bytesPerToken, fraction: s.fraction ?? DEFAULT_BUDGET_FRACTION }));
    const chars = candidates.find((c) => c >= rendered) ?? candidates[candidates.length - 1];
    return { chars, basis: 'inferred' };
}
function indexDisk(ctx) {
    const unusedSkills = new Set(ctx.issues.filter((i) => i.type === 'unused_skill').map((i) => i.path));
    const unusedPlugins = new Set(ctx.issues.filter((i) => i.type === 'unused_plugin').map((i) => i.name));
    const out = new Map();
    for (const s of ctx.localSkills)
        out.set(s.name, { skill: s, flaggedUnused: unusedSkills.has(s.path) });
    for (const s of ctx.syncedSkills)
        out.set(s.name, { skill: s, flaggedUnused: false });
    for (const s of ctx.pluginSkills) {
        const flaggedUnused = (s.plugin !== undefined && unusedPlugins.has(s.plugin)) ||
            (s.pluginName !== undefined && unusedPlugins.has(s.pluginName));
        for (const owner of [s.plugin, s.pluginName]) {
            if (owner && !out.has(`${owner}:${s.name}`))
                out.set(`${owner}:${s.name}`, { skill: s, flaggedUnused });
        }
    }
    return out;
}
export function analyzeListingVisibility(m, ctx) {
    const listing = m?.skillListing;
    if (!m || !listing)
        return null;
    const budget = inferBudgetChars(m, ctx.settings);
    const width = listing.width || listing.chars;
    const tokensPerWidth = width > 0 ? listing.tokens / width : 1 / 3;
    const disk = indexDisk(ctx);
    const overrides = ctx.settings.skillOverrides ?? {};
    const byChoice = (name) => overrides[name] === 'name-only';
    const describe = (name) => {
        const hit = disk.get(name);
        if (!hit)
            return { name, source: 'unknown', flaggedUnused: false };
        const owner = hit.skill.source === 'plugin' ? hit.skill.plugin ?? hit.skill.pluginName : undefined;
        return { name, source: hit.skill.source, ...(owner ? { plugin: owner } : {}), flaggedUnused: hit.flaggedUnused };
    };
    const collapsedEntries = listing.entries.filter((e) => e.collapsed && !byChoice(e.name));
    const collapsed = collapsedEntries.map((e) => describe(e.name));
    // Tokens a hidden description would add back: the disk listing line minus
    // its name. Unmatched skills get a flat estimate.
    const hiddenTokens = (name) => {
        const hit = disk.get(name);
        const line = hit?.skill.listingTokens ?? UNKNOWN_SKILL_TOKENS;
        return Math.max(1, Math.round(line - displayWidth(`- ${name}: `) * tokensPerWidth));
    };
    // What cleaning every flagged skill would free, in budget width: the unused
    // slack, each flagged line in full, and its newline. Then hand the room back
    // to collapsed skills in Claude Code's priority order, greedily, as it does.
    const flagged = new Set(listing.entries.filter((e) => disk.get(e.name)?.flaggedUnused).map((e) => e.name));
    let room = Math.max(0, budget.chars - width) +
        listing.entries
            .filter((e) => flagged.has(e.name))
            .reduce((sum, e) => sum + e.width + 1, 0);
    const priority = (name) => skillPriority(ctx.skillUsage[name], ctx.now);
    const candidates = collapsedEntries
        .filter((e) => !flagged.has(e.name))
        .sort((a, b) => priority(b.name) - priority(a.name));
    let restored = 0;
    for (const e of candidates) {
        const need = Math.round(hiddenTokens(e.name) / tokensPerWidth) + 2;
        if (need <= room) {
            room -= need;
            restored += 1;
        }
    }
    const overBudget = collapsed.length > 0
        ? (() => {
            const capTokens = Math.round(budget.chars * tokensPerWidth);
            const hidden = collapsedEntries.reduce((sum, e) => sum + hiddenTokens(e.name), 0);
            return { capTokens, fullTokens: capTokens + hidden };
        })()
        : undefined;
    return {
        sessionFile: m.sessionFile,
        ...(m.timestamp ? { sessionDate: m.timestamp.slice(0, 10) } : {}),
        ...(m.version ? { claudeCodeVersion: m.version } : {}),
        ...(m.entrypoint ? { entrypoint: m.entrypoint } : {}),
        fromOtherProject: m.fromOtherProject,
        skillCount: listing.skillCount,
        listingChars: listing.chars,
        listingWidth: width,
        listingTokens: listing.tokens,
        budgetChars: budget.chars,
        budgetBasis: budget.basis,
        collapsed,
        nameOnlyByChoice: listing.entries.filter((e) => byChoice(e.name)).length,
        ...(overBudget ? { overBudget } : {}),
        restoredIfFlaggedCleaned: restored,
    };
}
/** The skill listing never costs more than its budget. */
export function cappedListingTokens(fullTokens, capTokens) {
    return capTokens === undefined ? fullTokens : Math.min(fullTokens, capTokens);
}
/**
 * Startup tokens actually freed by removing `removedTokens` of listing from a
 * listing worth `fullTokens` uncapped. While the listing stays over budget,
 * removal only lets other descriptions back in — the prompt does not shrink.
 */
export function cappedRecovery(fullTokens, removedTokens, capTokens) {
    if (capTokens === undefined)
        return removedTokens;
    return Math.max(0, Math.min(fullTokens, capTokens) - Math.min(Math.max(0, fullTokens - removedTokens), capTokens));
}
