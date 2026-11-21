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
/**
 * True when a local skill was invoked under any name it answers to. A nested
 * skill `org/ship` may be recorded as `org/ship`, as its directory-scoped slash
 * form `org:ship` (`apps/web/deploy` → `apps/web:deploy`), or by its leaf
 * `ship`. Erring toward "used" is the safe side: it only withholds a hint.
 */
export declare function isLocalSkillUsed(name: string, signals: UsageSignals): boolean;
/**
 * True when any user-callable surface of a plugin was invoked. Commands are
 * stored bare (`bar`) but logged namespaced (`myplug:bar`), and a plugin skill
 * can be typed as `/myplug:skill` without a Skill call, so every surface is
 * checked in both forms against both signal sets.
 */
export declare function isPluginSurfaceUsed(ps: Pick<PluginSurfaces, 'pluginName' | 'skills' | 'commands' | 'mcpToolPrefixes'>, signals: UsageSignals): boolean;
