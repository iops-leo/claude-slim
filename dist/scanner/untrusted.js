/**
 * Names read off disk are written by whoever authored the skill, plugin, or
 * memory file — not by the user running the scan. They flow through the report
 * into the agent's context, which makes them an indirect prompt injection
 * surface: a skill directory or frontmatter `name:` can carry instructions
 * aimed at the model rather than a label aimed at a human.
 *
 * Snyk's audit of this skill (W011, medium 0.30) is about exactly this path.
 * The scan never emits file *bodies* — descriptions are measured for token cost
 * and then discarded — so what this module covers is the whole exposed surface,
 * not a sample of it.
 */
/** Longest label we render. Real names are far shorter; payloads are not. */
export const MAX_NAME_LENGTH = 120;
/** C0/C1 controls, including the newlines that would forge new report rows. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
/**
 * Zero-width and bidi-override characters: invisible to the human reading the
 * report, fully visible to the model reading the same string.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
/**
 * Collapse an untrusted label to a single bounded, printable line.
 *
 * Deliberately not an escape or an encoding: the value is a display label, and
 * a reversible transform would relocate a payload rather than remove it.
 */
export function sanitizeUntrusted(value, max = MAX_NAME_LENGTH) {
    const flattened = value
        .replace(CONTROL_CHARS, ' ')
        .replace(INVISIBLE, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (flattened.length <= max)
        return flattened;
    return `${flattened.slice(0, max)}…`;
}
/**
 * Paths are shown to the user and used to locate files for cleanup, so they are
 * flattened but never truncated — a shortened path would be a wrong path.
 */
function sanitizePath(value) {
    return value.replace(CONTROL_CHARS, ' ').replace(INVISIBLE, '').trim();
}
/**
 * Return a copy of the scan with every outsider-authored label flattened.
 *
 * Applied once at the scanner's exit rather than at each of the dozen sites
 * that read a name off disk: one chokepoint cannot be forgotten by whoever adds
 * the next detector.
 */
export function sanitizeScanResult(result) {
    const skill = (s) => ({
        ...s,
        name: sanitizeUntrusted(s.name),
        path: sanitizePath(s.path),
    });
    return {
        ...result,
        localSkills: result.localSkills.map(skill),
        pluginSkills: result.pluginSkills.map(skill),
        plugins: result.plugins.map((p) => ({
            ...p,
            name: sanitizeUntrusted(p.name),
            skills: p.skills.map((s) => sanitizeUntrusted(s)),
        })),
        brokenSymlinks: result.brokenSymlinks.map((b) => ({
            ...b,
            name: sanitizeUntrusted(b.name),
            path: sanitizePath(b.path),
            target: sanitizeUntrusted(b.target),
        })),
        memoryFiles: result.memoryFiles.map((m) => ({
            ...m,
            project: sanitizeUntrusted(m.project),
            name: sanitizeUntrusted(m.name),
            path: sanitizePath(m.path),
        })),
        claudeMdSections: result.claudeMdSections.map((s) => ({
            ...s,
            name: sanitizeUntrusted(s.name),
        })),
        mcpServerNames: result.mcpServerNames.map((n) => sanitizeUntrusted(n)),
        issues: result.issues.map((i) => ({
            ...i,
            name: sanitizeUntrusted(i.name),
            path: sanitizePath(i.path),
            ...(i.detail === undefined ? {} : { detail: sanitizeUntrusted(i.detail) }),
            ...(i.marketplace === undefined
                ? {}
                : { marketplace: sanitizeUntrusted(i.marketplace) }),
        })),
        pluginBreakdown: result.pluginBreakdown.map((p) => ({
            ...p,
            name: sanitizeUntrusted(p.name),
            marketplace: sanitizeUntrusted(p.marketplace),
        })),
        userAgents: result.userAgents.map((a) => ({ ...a, name: sanitizeUntrusted(a.name) })),
        userCommands: result.userCommands.map((c) => ({ ...c, name: sanitizeUntrusted(c.name) })),
    };
}
