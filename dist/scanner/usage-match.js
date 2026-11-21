function hasAny(signals, names) {
    for (const n of names) {
        if (signals.skills.has(n) || signals.commands.has(n))
            return true;
    }
    return false;
}
/**
 * True when a local skill was invoked under any name it answers to. A nested
 * skill `org/ship` may be recorded as `org/ship`, as its directory-scoped slash
 * form `org:ship` (`apps/web/deploy` → `apps/web:deploy`), or by its leaf
 * `ship`. Erring toward "used" is the safe side: it only withholds a hint.
 */
export function isLocalSkillUsed(name, signals) {
    const forms = [name];
    const slash = name.lastIndexOf('/');
    if (slash !== -1) {
        forms.push(name.slice(slash + 1));
        forms.push(`${name.slice(0, slash)}:${name.slice(slash + 1)}`);
        forms.push(name.replace(/\//g, ':'));
    }
    return hasAny(signals, forms);
}
/**
 * True when any user-callable surface of a plugin was invoked. Commands are
 * stored bare (`bar`) but logged namespaced (`myplug:bar`), and a plugin skill
 * can be typed as `/myplug:skill` without a Skill call, so every surface is
 * checked in both forms against both signal sets.
 */
export function isPluginSurfaceUsed(ps, signals) {
    const named = [...ps.skills, ...ps.commands];
    if (named.some((n) => hasAny(signals, [n, `${ps.pluginName}:${n}`])))
        return true;
    return ps.mcpToolPrefixes.some((p) => signals.mcpPrefixes.has(p));
}
