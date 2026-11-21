/** `<plugin>@<marketplace>` — the unit Claude Code enables and disables. */
export declare function pluginIdentity(plugin: string, marketplace: string): string;
/**
 * Plugins `claude plugin list` reports disabled, as `<plugin>@<marketplace>`.
 *
 * Per plugin, not per marketplace: collapsing to the marketplace (pre-2.17)
 * marked every plugin from it disabled as soon as one was. The list has one
 * row per scope, so an identity enabled in any scope counts as enabled.
 */
export declare function parseDisabledPlugins(output: string): Set<string>;
export declare function getDisabledPlugins(): Promise<Set<string>>;
export interface InstalledPlugin {
    name: string;
    marketplace: string;
    enabled: boolean;
}
export declare function parseInstalledPlugins(output: string): InstalledPlugin[];
export declare function getInstalledPlugins(): Promise<InstalledPlugin[]>;
