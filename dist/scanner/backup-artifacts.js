// Backup-artifact detection.
//
// Unused-skill detection needs a usage signal. This does not: a name like
// `humanize-korean.bak.20260711-100101` is self-evidently a leftover copy
// regardless of whether anything ever invoked it. That makes it the one useful
// cleanup hint that works even on Codex, where session logs carry no
// invocation history.
//
// The whole risk here is false positives. `backup-manager`, `test-engineer`,
// and `old-school-linter` are real skills whose names merely contain the words
// "backup", "test", and "old". So these patterns match only *artifact shapes* —
// dotted segments, trailing markers, timestamp suffixes — never a bare
// substring anywhere in the name.
const PATTERNS = [
    // `foo.bak`, `foo.bak.20260711` — dotted segment, not the word "bak" inside a name.
    { re: /\.bak(\.|$)/i, label: '.bak' },
    { re: /\.backup(\.|$)/i, label: '.backup' },
    { re: /\.orig(\.|$)/i, label: '.orig' },
    { re: /\.old(\.|$)/i, label: '.old' },
    { re: /\.save(\.|$)/i, label: '.save' },
    { re: /\.disabled(\.|$)/i, label: '.disabled' },
    // `foo.20260711` / `foo.20260711-100101` — a dated snapshot.
    { re: /\.\d{8}(-\d{6})?(\.|$)/, label: 'timestamp suffix' },
    // `foo-2026-07-11`
    { re: /[-_]\d{4}-\d{2}-\d{2}(\.|$)/, label: 'dated suffix' },
    // Editor/rsync leftovers.
    { re: /~$/, label: 'editor backup' },
    // `foo copy`, `foo-copy`, `foo (copy)` — trailing only.
    { re: /[ _-]\(?copy\)?$/i, label: 'copy suffix' },
    { re: /^copy[ _-]of[ _-]/i, label: 'copy-of prefix' },
    // `foo (1)` — duplicate-download naming.
    { re: / \(\d+\)$/, label: 'numbered duplicate' },
];
/**
 * Return why `name` looks like a backup artifact, or null if it does not.
 *
 * Matches on the entry name only. Callers decide what to do with it — the
 * Claude path raises a cleanup issue, the Codex path only reports.
 */
export function detectBackupArtifact(name) {
    for (const { re, label } of PATTERNS) {
        if (re.test(name))
            return { label };
    }
    return null;
}
