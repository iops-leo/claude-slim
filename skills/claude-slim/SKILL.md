---
name: claude-slim
description: "Analyze and reduce Claude Code token overhead. Scans skills, plugins, memory files, and CLAUDE.md for bloat — then cleans up with user approval. Use when: /claude-slim, token optimization, reduce tokens, slim down, cleanup skills, token diet, save tokens, context diet"
---

# claude-slim — Token Overhead Reducer

Analyze the user's Claude Code environment for token waste and perform non-destructive cleanup.

## Subcommands

- `/claude-slim` or `/claude-slim run` → full pipeline (scan → propose → execute → report)
- `/claude-slim scan` → report only, no changes
- `/claude-slim scan --json` → raw JSON output
- `/claude-slim restore` → restore previously disabled items

---

## Phase 1 — Scan

Run the CLI to collect environment data:

```bash
cd "${CLAUDE_PLUGIN_ROOT}" && node dist/cli.js scan --json
```

If `CLAUDE_PLUGIN_ROOT` is not set:
```bash
PLUGIN_DIR=$(find ~/.claude/plugins -path "*/claude-slim/dist/cli.js" -type f 2>/dev/null | head -1 | xargs dirname | xargs dirname)
cd "$PLUGIN_DIR" && node dist/cli.js scan --json
```

If `node` is not available, fall back to the legacy bash scanner:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/claude-slim/scripts/scan.sh"
```

---

## Phase 2 — Interpret & Present

After getting the scan JSON, YOU must interpret and present results to the user. Do NOT just dump raw CLI output. Present a full diagnostic report in the user's language.

> **Templates below are shown in English for readability. Always translate headers, labels, and prompts into the user's detected language when rendering.**

### 2-1. Environment Snapshot Table

Show a summary table:

| Item | Count | Tokens |
|------|-------|--------|
| Local skills | N (XKB) | X tok |
| Plugins | N (M skills) | ~X tok |
| CLAUDE.md | XKB | X tok |
| Memory files | N (XKB) | ~X tok |
| **Session startup overhead** | | **~X tok** |

### 2-2. Plugin Detail Table

List each plugin with skill count and a judgment:

| Plugin | Skills | Notes |
|--------|:------:|-------|
| omc | 36 | Core plugin. Keep. |
| temp_local_... | 1 | **Failed install remnant. Cleanup target.** |

Annotate each with status: actively used, possibly unused, or cleanup target. Flag `temp_local_*` entries as failed install remnants.

### 2-3. Issue Analysis by Tier

Group issues by tier and explain EACH one with context and recommendation:

**Tier 1 — Immediate cleanup (zero risk):**
These are safe to remove with zero risk: broken symlinks, empty templates, .skill/ duplicates, temp_local_* cache. Pre-selected. Explain why each is safe.

**Tier 2 — Recommended cleanup:**
These are recommended but need user judgment. For each issue, explain:
- What is it and why it's flagged
- What happens if you remove it (safe? any side effects?)
- How many tokens it saves

Example: "frontend-design exists both locally and in a plugin. Removing the local copy is safe because the plugin version remains. Saves ~823 tok."

**Tier 3 — Optional (user judgment):**
These are large skills that cost tokens but might be in active use. For each:
- Show size and token cost
- Judge whether the user likely uses it (based on what it does)
- Recommend: keep if active, disable if rarely used

### 2-4. Recommended Actions

End with a numbered action list, ordered by impact:
1. What to do first (highest token savings, lowest risk)
2. What to consider
3. What to leave alone and why

Show estimated total token savings if all recommended actions are taken.

If subcommand is `scan`, stop here. Ask a localized equivalent of "Proceed with cleanup?" only for the full pipeline.

---

## Phase 3 — Clean (full pipeline only)

Run the interactive clean command:

```bash
cd "${CLAUDE_PLUGIN_ROOT}" && node dist/cli.js clean
```

Or with dry-run:
```bash
cd "${CLAUDE_PLUGIN_ROOT}" && node dist/cli.js clean --dry-run
```

After cleanup, re-run scan to get updated numbers, then show the savings report:

```bash
cd "${CLAUDE_PLUGIN_ROOT}" && node dist/cli.js report
```

Present the report box AND the before/after breakdown table to the user.

---

## Phase 4 — Restore

When `/claude-slim restore` is invoked:

```bash
cd "${CLAUDE_PLUGIN_ROOT}" && node dist/cli.js restore
```

---

## Language

Detect the user's language from their most recent message. Present all reports, analysis, and explanations in that language — including table headers, tier labels, prompts, and every user-facing string. The CLI output is machine-readable (always English) and must not be echoed verbatim; translate its content into the user's language when you interpret it. The example tables above are written in English only for authoring clarity — do not treat them as a required output format.

## Rules

1. **Never delete.** The CLI moves items to `~/.claude/skills.disabled/`.
2. **Never modify CLAUDE.md or settings.json.**
3. **Never disable plugin-managed skills.** Report only.
4. **Always confirm before executing.** Use `--dry-run` to preview changes.
5. **If nothing to clean:** respond "Already slim!" and exit.
6. **Always interpret results.** Never dump raw CLI output without analysis. You are the diagnostic layer — the CLI is the data layer.
