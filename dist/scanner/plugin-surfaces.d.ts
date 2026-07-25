export interface PluginSurfaces {
    pluginName: string;
    marketplace: string;
    version: string;
    installDir: string;
    installedAt: number;
    skills: string[];
    skillListingTokens: number;
    mcpServerKeys: string[];
    mcpToolPrefixes: string[];
    commands: string[];
    agentCount: number;
    hookCount: number;
}
export declare function scanPluginSurfaces(): PluginSurfaces[];
