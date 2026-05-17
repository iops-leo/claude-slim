import type { PluginBreakdown } from '../types.js';
import type { PluginSurfaces } from './plugin-surfaces.js';
import type { InstalledPlugin } from './disabled-plugins.js';
import type { ClaudeMdSection } from './plugin-cost.js';
export interface PluginBreakdownOptions {
    surfaces: PluginSurfaces[];
    installedPlugins: InstalledPlugin[];
    invokedSkills: Set<string>;
    mcpPrefixesInvoked: Set<string>;
    commandsInvoked: Set<string>;
    totalUserCallableInvocations: number;
    sessionsInWindow: number;
    claudeMdSections: ClaudeMdSection[];
}
export declare function computePluginBreakdown(opts: PluginBreakdownOptions): PluginBreakdown[];
export declare function formatPluginsTable(rows: PluginBreakdown[], totalInstalled: number, totalEnabled: number): string;
