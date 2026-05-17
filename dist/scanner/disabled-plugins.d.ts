export declare function parseDisabledPlugins(output: string): Set<string>;
export declare function getDisabledPlugins(): Promise<Set<string>>;
export interface InstalledPlugin {
    name: string;
    marketplace: string;
    enabled: boolean;
}
export declare function parseInstalledPlugins(output: string): InstalledPlugin[];
export declare function getInstalledPlugins(): Promise<InstalledPlugin[]>;
