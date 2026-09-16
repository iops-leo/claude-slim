export interface ClaudeMdImport {
    /** The spec as written after `@`. */
    spec: string;
    /** Resolved absolute path. */
    path: string;
    /** The file that named it. */
    from: string;
    /** 1 for a direct import of CLAUDE.md, up to CLAUDE_MD_IMPORT_MAX_DEPTH. */
    depth: number;
    sizeBytes: number;
    tokens: number;
}
/**
 * Import specs in the order they appear, ignoring fenced code blocks, inline
 * code spans and HTML comments — the places Claude Code does not read imports
 * from. Trailing sentence punctuation is dropped so `@docs/x.md.` imports
 * `docs/x.md`.
 *
 * A fence closes only on a run of the same character at least as long as the
 * one that opened it, so a ``` line inside a ~~~ block, or a ``` inside a
 * ```` block, stays inside.
 */
export declare function extractImportSpecs(content: string): string[];
/**
 * Every file `rootPath` transitively imports, in discovery order.
 *
 * Targets that do not exist are dropped rather than reported: `@claude` or
 * `@scope/pkg` in prose match the syntax but Claude Code loads nothing for
 * them, so listing them would only add noise. A file already visited — the
 * root included, compared by real path so a symlink and its target are one
 * file — is not expanded twice, which is what keeps a cycle finite.
 */
export declare function resolveClaudeMdImports(rootPath: string, rootContent: string): Promise<ClaudeMdImport[]>;
