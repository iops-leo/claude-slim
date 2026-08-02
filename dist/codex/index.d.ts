import { parseFrontmatterDescription } from '../scanner/skill-listing.js';
export declare const UNUSED_DETECTION_REASON = "Codex session logs record the skill catalog, not invocations \u2014 there is no reliable usage signal to detect unused skills from.";
export interface CodexSkill {
    name: string;
    path: string;
    sizeBytes: number;
    /** Full SKILL.md body — what the skill costs once invoked. */
    tokens: number;
    /** The `- name: description` line it adds to the system prompt. */
    listingTokens: number;
    source: 'local' | 'plugin';
    pluginName?: string;
    /** Set when the name looks like a leftover copy; reported, never acted on. */
    backupArtifact?: string;
}
export interface CodexAgent {
    name: string;
    path: string;
    sizeBytes: number;
    tokens: number;
    listingTokens: number;
}
export interface CodexScanResult {
    root: string;
    skills: CodexSkill[];
    agents: CodexAgent[];
    instructionsBytes: number;
    instructionsTokens: number;
    /** Skill + agent listing lines + AGENTS.md — the fixed startup cost. */
    totalTokens: number;
    unusedDetectionAvailable: false;
    unusedDetectionReason: string;
}
export declare function getCodexDir(): string;
export declare function isCodexInstalled(): Promise<boolean>;
/**
 * Pull `description` out of a Codex agent TOML.
 *
 * All 18 agents observed use a single-line `description = "…"`; the multi-line
 * `"""` form is handled too so a future agent using it does not silently fall
 * back to the flat estimate.
 */
export declare function parseTomlDescription(content: string): string | null;
/**
 * @param contents optional sink for SKILL.md bodies, so detectors can inspect
 *   them without a second pass over the filesystem. Deliberately an out-param
 *   rather than part of the result: it must not land in `scan --json`.
 */
export declare function scanCodex(contents?: Map<string, string>): Promise<CodexScanResult | null>;
/** Re-exported so callers can reuse the frontmatter parser without a deep import. */
export { parseFrontmatterDescription };
