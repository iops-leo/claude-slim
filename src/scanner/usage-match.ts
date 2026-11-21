import type { PluginSurfaces } from './plugin-surfaces.js';

/**
 * How a skill shows up in usage signals. A Skill tool call records the skill
 * id; typing `/daily` records only `<command-name>/daily</command-name>`, with
 * no Skill call at all. Both mean the skill is in use, so both sets are read.
 */
export interface UsageSignals {
  /** Skill tool ids (and usage-record keys), e.g. `daily`, `superpowers:brainstorming`. */
  skills: Set<string>;
  /** Slash commands without the leading `/`, e.g. `daily`, `myplug:bar`, `apps/web:deploy`. */
  commands: Set<string>;
  mcpPrefixes: Set<string>;
}

function hasAny(signals: UsageSignals, names: Iterable<string>): boolean {
  for (const n of names) {
    if (signals.skills.has(n) || signals.commands.has(n)) return true;
  }
  return false;
}

/**
 * True when a local skill was invoked under any name it answers to. A nested
 * skill `org/ship` may be recorded as `org/ship`, as its directory-scoped slash
 * form `org:ship` (`apps/web/deploy` → `apps/web:deploy`), or by its leaf
 * `ship`. Erring toward "used" is the safe side: it only withholds a hint.
 */
export function isLocalSkillUsed(name: string, signals: UsageSignals): boolean {
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
export function isPluginSurfaceUsed(
  ps: Pick<PluginSurfaces, 'pluginName' | 'skills' | 'commands' | 'mcpToolPrefixes'>,
  signals: UsageSignals,
): boolean {
  const named = [...ps.skills, ...ps.commands];
  if (named.some((n) => hasAny(signals, [n, `${ps.pluginName}:${n}`]))) return true;
  return ps.mcpToolPrefixes.some((p) => signals.mcpPrefixes.has(p));
}
