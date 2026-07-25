import { join } from 'node:path';
import { getClaudeDir } from '../paths.js';
import { countTokensCached } from '../tokenizer.js';
import { safeReadFile, safeReaddir, isBrokenSymlink } from './fs-walk.js';
import { listingTokens, parseFrontmatterDescription } from './skill-listing.js';
import { COMMAND_OVERHEAD_TOKENS } from './constants.js';
export function getUserAgentsDir() {
    return join(getClaudeDir(), 'agents');
}
export function getUserCommandsDir() {
    return join(getClaudeDir(), 'commands');
}
/** Agents render exactly like skills: `- <name>: <description>`. */
function agentListingCost(name, content) {
    return listingTokens(name, parseFrontmatterDescription(content));
}
/**
 * Commands without frontmatter appear as a bare name in the listing, which is
 * what COMMAND_OVERHEAD_TOKENS already estimates for plugin commands. With a
 * description they cost the same as a skill line.
 */
function commandListingCost(name, content) {
    const description = parseFrontmatterDescription(content);
    if (description === null)
        return COMMAND_OVERHEAD_TOKENS;
    return listingTokens(name, description);
}
async function scanMarkdownDir(dir, listingCost) {
    const entries = await safeReaddir(dir);
    const results = await Promise.all(entries.map(async (entry) => {
        if (!entry.endsWith('.md'))
            return null;
        const path = join(dir, entry);
        // Symlinked agents are common (vendored packs link into ~/.claude/agents).
        // A dangling link contributes nothing to the prompt — skip it rather than
        // counting a phantom entry.
        if (await isBrokenSymlink(path))
            return null;
        const content = await safeReadFile(path);
        if (content === null)
            return null;
        const name = entry.slice(0, -3);
        return {
            name,
            path,
            sizeBytes: Buffer.byteLength(content),
            tokens: countTokensCached(content, path),
            listingTokens: listingCost(name, content),
        };
    }));
    return results.filter((r) => r !== null);
}
export async function scanUserSurfaces() {
    const [agents, commands] = await Promise.all([
        scanMarkdownDir(getUserAgentsDir(), agentListingCost),
        scanMarkdownDir(getUserCommandsDir(), commandListingCost),
    ]);
    return { agents, commands };
}
