export interface RuleEntry {
    /** Path relative to the rules directory, e.g. `common/style.md`. */
    name: string;
    path: string;
    sizeBytes: number;
    tokens: number;
    /** True when `paths:` frontmatter scopes the rule to matching files. */
    conditional: boolean;
    /** The globs from `paths:`; empty for an unconditional rule. */
    paths: string[];
}
/**
 * The `paths:` list from a rule's frontmatter, or null when absent.
 *
 * Handles the YAML shapes seen in the wild — a block list at any indent, an
 * inline flow list, and a bare scalar — without pulling in a YAML parser for
 * one key. Comments and blank lines inside a block list are skipped; the list
 * ends at the next top-level key.
 */
export declare function parseFrontmatterPaths(content: string): string[] | null;
export declare function getUserRulesDir(): string;
export declare function scanUserRules(): Promise<RuleEntry[]>;
