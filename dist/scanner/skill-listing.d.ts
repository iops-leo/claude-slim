/**
 * Extract the `description` value from a SKILL.md (or agent .md) frontmatter
 * block. Returns null when there is no frontmatter or no description key —
 * callers fall back to {@link SKILL_PROMPT_OVERHEAD_TOKENS}.
 */
export declare function parseFrontmatterDescription(content: string): string | null;
/**
 * Token cost of one entry in the system prompt's skill listing.
 *
 * Falls back to the flat {@link SKILL_PROMPT_OVERHEAD_TOKENS} estimate when the
 * description is missing or unreadable, so a malformed SKILL.md degrades to the
 * pre-2.8 behaviour rather than reporting zero.
 */
export declare function listingTokens(name: string, description: string | null): number;
/** Convenience wrapper: parse a raw SKILL.md and return its listing cost. */
export declare function listingTokensFromContent(name: string, content: string): number;
