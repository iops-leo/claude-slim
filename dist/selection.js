/** Expand a `N` or `N-M` fragment into 1-based indices, or null if malformed. */
function parseFragment(part, count) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
        const lo = parseInt(range[1], 10);
        const hi = parseInt(range[2], 10);
        if (lo < 1 || hi < 1 || lo > count || hi > count || lo > hi)
            return null;
        return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
    }
    if (!/^\d+$/.test(part))
        return null;
    const num = parseInt(part, 10);
    if (num < 1 || num > count)
        return null;
    return [num];
}
export function parseSelection(input, count) {
    const indices = [];
    const invalid = [];
    const seen = new Set();
    for (const raw of input.trim().toLowerCase().split(',')) {
        const part = raw.trim();
        if (part === '')
            continue;
        const nums = parseFragment(part, count);
        if (nums === null) {
            invalid.push(part);
            continue;
        }
        for (const num of nums) {
            if (seen.has(num))
                continue;
            seen.add(num);
            indices.push(num);
        }
    }
    return { indices, invalid };
}
export function resolveSelection(input, issues) {
    const trimmed = input.trim().toLowerCase();
    if (trimmed === 'none' || trimmed === 'n')
        return [];
    if (trimmed === 'all' || trimmed === 'a')
        return [...issues];
    if (trimmed === '' || trimmed === 'enter') {
        // Default: tier 1 only
        return issues.filter((i) => i.tier === 1);
    }
    return parseSelection(trimmed, issues.length).indices.map((n) => issues[n - 1]);
}
export function resolveRestoreSelection(input, count) {
    const trimmed = input.trim().toLowerCase();
    if (trimmed === 'none' || trimmed === 'n' || trimmed === '')
        return [];
    if (trimmed === 'all' || trimmed === 'a') {
        return Array.from({ length: count }, (_, i) => i);
    }
    // 0-based, unlike resolveSelection — restore indexes into the manifest array.
    return parseSelection(trimmed, count).indices.map((n) => n - 1);
}
