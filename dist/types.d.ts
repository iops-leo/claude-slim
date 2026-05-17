export interface SkillInfo {
    name: string;
    path: string;
    sizeBytes: number;
    tokens: number;
    source: 'local' | 'plugin';
    pluginName?: string;
}
export interface BrokenSymlink {
    name: string;
    path: string;
    target: string;
}
export interface MemoryFile {
    project: string;
    name: string;
    path: string;
    sizeBytes: number;
    tokens: number;
}
export interface PluginInfo {
    name: string;
    skillCount: number;
    skills: string[];
    status?: 'enabled' | 'disabled';
}
export type IssueTier = 1 | 2 | 3;
export type IssueType = 'broken_symlink' | 'template' | 'skill_dup' | 'duplicate' | 'oversized_memory' | 'oversized_skill' | 'unused_skill' | 'unused_plugin' | 'disabled_plugin' | 'stale_project' | 'temp_cache';
export interface Issue {
    type: IssueType;
    tier: IssueTier;
    name: string;
    detail?: string;
    tokens: number;
    path: string;
    marketplace?: string;
}
export interface PluginBreakdown {
    name: string;
    marketplace: string;
    tokens: number;
    skills: number;
    mcp: number;
    commands: number;
    lastUsed: 'used' | 'never';
    status: 'used' | 'unused' | 'agent-only' | 'insufficient data' | 'disabled';
}
export interface ScanResult {
    localSkills: SkillInfo[];
    pluginSkills: SkillInfo[];
    plugins: PluginInfo[];
    brokenSymlinks: BrokenSymlink[];
    memoryFiles: MemoryFile[];
    claudeMdBytes: number;
    claudeMdTokens: number;
    claudeMdSections: Array<{
        name: string;
        sizeBytes: number;
        tokens: number;
    }>;
    mcpServers: number;
    mcpServerNames: string[];
    issues: Issue[];
    totalTokensBefore: number;
    pluginBreakdown: PluginBreakdown[];
}
export interface ManifestEntry {
    date: string;
    name: string;
    from: string;
    type: IssueType;
    tokenCount?: number;
    tier?: IssueTier;
}
export type LegacyManifestEntry = ManifestEntry;
export interface DisabledPluginEntry {
    type: 'disabled_plugin';
    plugin: string;
    marketplace: string;
    disabledAt: string;
}
export type AnyManifestEntry = ManifestEntry | DisabledPluginEntry;
export interface Manifest {
    version: 2;
    entries: AnyManifestEntry[];
}
export interface TokenCache {
    version: number;
    entries: Record<string, {
        hash: string;
        tokens: number;
    }>;
}
