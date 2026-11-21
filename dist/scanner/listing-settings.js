const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
function readUsage(claudeJson) {
    const raw = claudeJson?.skillUsage;
    if (!isObject(raw))
        return {};
    const out = {};
    for (const [name, v] of Object.entries(raw)) {
        if (!isObject(v))
            continue;
        const { usageCount, lastUsedAt } = v;
        if (typeof usageCount === 'number' && typeof lastUsedAt === 'number') {
            out[name] = { usageCount, lastUsedAt };
        }
    }
    return out;
}
export function listingSettingsFrom(src) {
    // Lowest precedence first, so later spreads win.
    const layers = [
        src.userSettings,
        src.projectSettings,
        ...[...src.localSettingsList].reverse(),
        src.managedSettings,
    ].filter(isObject);
    let fraction;
    let envBudget;
    let skillOverrides = {};
    for (const layer of layers) {
        const f = layer.skillListingBudgetFraction;
        if (typeof f === 'number' && f > 0)
            fraction = f;
        if (isObject(layer.skillOverrides))
            skillOverrides = { ...skillOverrides, ...layer.skillOverrides };
        const env = isObject(layer.env) ? layer.env.SLASH_COMMAND_TOOL_CHAR_BUDGET : undefined;
        if (typeof env === 'string' || typeof env === 'number')
            envBudget = String(env);
    }
    return {
        ...(fraction !== undefined ? { fraction } : {}),
        ...(envBudget !== undefined ? { envBudget } : {}),
        skillOverrides,
        skillUsage: readUsage(src.claudeJson),
    };
}
