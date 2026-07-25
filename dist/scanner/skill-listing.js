import { countTokens } from '../tokenizer.js';
import { SKILL_PROMPT_OVERHEAD_TOKENS } from './constants.js';
// Claude Code renders each available skill into the system prompt as one line:
//   `- <name>: <description>`
// The description comes from the SKILL.md YAML frontmatter and is reproduced
// verbatim, so its real length — not a flat per-skill constant — is what the
// session actually pays for. Measured across 68 installed skills the spread is
// 30 → 509 tokens (mean 51), which a fixed estimate cannot represent.
const LISTING_PREFIX = '- ';
const LISTING_SEPARATOR = ': ';
// Frontmatter block at the very top of the file: `---\n<yaml>\n---`.
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
// `description:` up to the next top-level key. YAML folded/literal blocks and
// plain multi-line values both indent their continuation lines, so "next line
// that starts at column 0 with `key:`" is the terminator.
//
// Deliberately NOT /m: with the multiline flag `$` matches end-of-line, which
// would terminate the capture at the first newline and silently truncate every
// wrapped description to its first line.
const DESCRIPTION_PATTERN = /(?:^|\n)description:[ \t]*([\s\S]*?)(?=\r?\n[A-Za-z_][\w-]*:|$)/;
/**
 * Extract the `description` value from a SKILL.md (or agent .md) frontmatter
 * block. Returns null when there is no frontmatter or no description key —
 * callers fall back to {@link SKILL_PROMPT_OVERHEAD_TOKENS}.
 */
export function parseFrontmatterDescription(content) {
    const fm = FRONTMATTER_PATTERN.exec(content);
    if (!fm)
        return null;
    const match = DESCRIPTION_PATTERN.exec(fm[1]);
    if (!match)
        return null;
    const raw = match[1]
        // Drop a leading YAML block scalar indicator (`|`, `>`, `|-`, `>-`, …).
        .replace(/^[|>][+-]?\d*[ \t]*\r?\n/, '')
        // Collapse the indentation + wrapping that YAML uses for long values;
        // the system prompt renders them as a single line.
        .split(/\r?\n/)
        .map((line) => line.trim())
        .join(' ')
        .trim();
    if (!raw)
        return null;
    // Strip surrounding quotes if the value was quoted.
    const unquoted = (raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
    return unquoted.trim() || null;
}
/**
 * Token cost of one entry in the system prompt's skill listing.
 *
 * Falls back to the flat {@link SKILL_PROMPT_OVERHEAD_TOKENS} estimate when the
 * description is missing or unreadable, so a malformed SKILL.md degrades to the
 * pre-2.8 behaviour rather than reporting zero.
 */
export function listingTokens(name, description) {
    if (description === null)
        return SKILL_PROMPT_OVERHEAD_TOKENS;
    return countTokens(LISTING_PREFIX + name + LISTING_SEPARATOR + description);
}
/** Convenience wrapper: parse a raw SKILL.md and return its listing cost. */
export function listingTokensFromContent(name, content) {
    return listingTokens(name, parseFrontmatterDescription(content));
}
