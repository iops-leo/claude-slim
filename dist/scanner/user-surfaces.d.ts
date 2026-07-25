export interface UserSurfaceEntry {
    name: string;
    path: string;
    sizeBytes: number;
    /** Full file body — what the agent/command costs once invoked. */
    tokens: number;
    /** What it costs at startup by merely existing. */
    listingTokens: number;
}
export interface UserSurfacesResult {
    agents: UserSurfaceEntry[];
    commands: UserSurfaceEntry[];
}
export declare function getUserAgentsDir(): string;
export declare function getUserCommandsDir(): string;
export declare function scanUserSurfaces(): Promise<UserSurfacesResult>;
