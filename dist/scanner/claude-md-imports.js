import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { countTokensCached } from '../tokenizer.js';
import { safeReadFile, safeStat, resolveRealPath } from './fs-walk.js';
import { CLAUDE_MD_IMPORT_MAX_DEPTH } from './constants.js';
/**
 * Anything larger is not instructions. Claude Code's own behaviour on a huge
 * import is not documented; what is certain is that reading and tokenizing a
 * multi-hundred-megabyte log because prose said `@archive.log` must not hang
 * a scan that is otherwise sub-second.
 */
const MAX_IMPORT_BYTES = 1024 * 1024;
// `@` at line start or after whitespace / an opening bracket, followed by a
// path. Preceded by a non-space it is an email or a handle, not an import.
const IMPORT_PATTERN = /(^|[\s([{])@((?:~\/|\.{1,2}\/|\/)?[A-Za-z0-9_.][A-Za-z0-9_./~-]*)/g;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
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
export function extractImportSpecs(content) {
    const specs = [];
    let fence = null;
    const body = content.replace(/<!--[\s\S]*?-->/g, ' ');
    for (const rawLine of body.split('\n')) {
        const m = FENCE.exec(rawLine);
        if (m) {
            const run = m[1];
            if (fence === null) {
                fence = run;
                continue;
            }
            if (run[0] === fence[0] && run.length >= fence.length) {
                fence = null;
                continue;
            }
        }
        if (fence !== null)
            continue;
        const line = rawLine.replace(/`[^`]*`/g, ' ');
        for (const hit of line.matchAll(IMPORT_PATTERN)) {
            const spec = hit[2].replace(/[.,:;!?)\]}]+$/, '');
            if (spec.length > 0)
                specs.push(spec);
        }
    }
    return specs;
}
function resolveSpec(spec, fromFile) {
    if (spec.startsWith('~/'))
        return join(homedir(), spec.slice(2));
    if (isAbsolute(spec))
        return resolve(spec);
    return resolve(dirname(fromFile), spec);
}
/**
 * Every file `rootPath` transitively imports, in discovery order.
 *
 * Targets that do not exist are dropped rather than reported: `@claude` or
 * `@scope/pkg` in prose match the syntax but Claude Code loads nothing for
 * them, so listing them would only add noise. A file already visited — the
 * root included, compared by real path so a symlink and its target are one
 * file — is not expanded twice, which is what keeps a cycle finite.
 */
export async function resolveClaudeMdImports(rootPath, rootContent) {
    const out = [];
    const visited = new Set([await resolveRealPath(resolve(rootPath))]);
    async function expand(fromFile, content, depth) {
        if (depth > CLAUDE_MD_IMPORT_MAX_DEPTH)
            return;
        for (const spec of extractImportSpecs(content)) {
            const path = resolveSpec(spec, fromFile);
            const st = await safeStat(path);
            if (st === null || !st.isFile() || st.size > MAX_IMPORT_BYTES)
                continue;
            const real = await resolveRealPath(path);
            if (visited.has(real))
                continue;
            const body = await safeReadFile(path);
            if (body === null)
                continue;
            visited.add(real);
            out.push({
                spec,
                path,
                from: fromFile,
                depth,
                sizeBytes: Buffer.byteLength(body),
                tokens: countTokensCached(body, path),
            });
            await expand(path, body, depth + 1);
        }
    }
    await expand(resolve(rootPath), rootContent, 1);
    return out;
}
