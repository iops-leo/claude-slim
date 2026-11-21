export interface ListingEntry {
    name: string;
    chars: number;
    /** Display width of the entry, the unit Claude Code budgets in. */
    width: number;
    /** Rendered as a bare name: the model sees no description for it. */
    collapsed: boolean;
}
export interface DeferredToolsSummary {
    count: number;
    chars: number;
    tokens: number;
    servers: Array<{
        server: string;
        tools: number;
        chars: number;
    }>;
    /** Tool names exposed by more than one MCP server. */
    collisions: Array<{
        tool: string;
        servers: string[];
    }>;
    /**
     * Server pairs sharing most of their tool names — almost always one
     * connector added twice (e.g. once by hand, once as a claude.ai connector).
     * `chars` is what the smaller copy's shared names cost in the listing.
     */
    duplicateServers: Array<{
        servers: [string, string];
        shared: number;
        chars: number;
    }>;
    needsAuth: string[];
}
export interface MeasuredStartup {
    sessionFile: string;
    fromOtherProject: boolean;
    entrypoint?: string;
    version?: string;
    model?: string;
    timestamp?: string;
    /** input + cache creation + cache read on the first assistant turn. */
    firstTurnInputTokens?: number;
    /** `chars` is string length; `width` is display width, the unit the budget is spent in. */
    skillListing?: {
        chars: number;
        width: number;
        tokens: number;
        skillCount: number;
        entries: ListingEntry[];
    };
    agentListing?: {
        chars: number;
        tokens: number;
        count: number;
    };
    mcpInstructions?: {
        chars: number;
        tokens: number;
        servers: Array<{
            name: string;
            chars: number;
        }>;
    };
    deferredTools?: DeferredToolsSummary;
    instructions?: {
        files: Array<{
            path: string;
            type: string;
            chars: number;
            tokens: number;
        }>;
    };
}
/**
 * Split a rendered skill listing into entries using the attachment's `names`
 * array, which is in render order. Descriptions may span lines, so splitting
 * on newlines would mis-assign them.
 */
export declare function parseSkillListing(content: string, names: readonly string[]): ListingEntry[];
export declare function analyzeDeferredTools(lines: readonly string[], needsAuth?: readonly string[]): DeferredToolsSummary;
/**
 * Read the session-start attachments of one log. Stops at the first main-chain
 * assistant turn: later attachments describe changes during the session, not
 * what every turn starts with. Returns null when the log has no skill listing
 * (older Claude Code, or a session that never started).
 */
export declare function readStartupAttachments(file: string, fromOtherProject?: boolean): Promise<MeasuredStartup | null>;
/**
 * The newest session in `slug` that recorded its startup context. Falls back
 * to the newest such session in any project (flagged `fromOtherProject`,
 * since memory and project CLAUDE.md differ).
 */
export declare function findMeasuredSession(projectsDir: string, slug: string): Promise<MeasuredStartup | null>;
