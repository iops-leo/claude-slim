---
name: claude-slim
description: "Analyze and reduce Claude Code token overhead. Scans skills, plugins, memory files, and CLAUDE.md for bloat — then cleans up with user approval. Use when: /claude-slim, token optimization, reduce tokens, slim down, cleanup skills, token diet, save tokens, context diet"
---

# claude-slim — Token Overhead Reducer

Analyze the user's Claude Code environment for token waste and perform non-destructive cleanup.

## Subcommands

- `/claude-slim` or `/claude-slim run` → full pipeline (scan → propose → execute → report)
- `/claude-slim scan` → report only, no changes
- `/claude-slim restore` → restore previously disabled items

---

## Phase 1 — Scan

Run the scanner script to collect environment data:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/claude-slim/scripts/scan.sh"
```

If `CLAUDE_PLUGIN_ROOT` is not set, locate the script via:
```bash
bash "$(find ~/.claude/plugins -path "*/claude-slim/scripts/scan.sh" -type f 2>/dev/null | head -1)"
```

The script outputs structured lines in `KEY:value` format. Parse the output to build the before snapshot.

---

## Phase 2 — Analyze & Propose

Categorize issues from the scan into three tiers:

**Tier 1 — Auto (pre-selected, safe to remove):**
- `broken_symlink` — dead links left from uninstalled skill packs
- `template` — placeholder skills with "Replace with description"
- `skill_dup` — `.skill/` directories when the base directory exists

**Tier 2 — Recommended (suggested, not pre-selected):**
- `duplicate` — local skill that a plugin already provides
- `oversized_memory` — memory files >5KB loaded every session

**Tier 3 — Optional (listed for awareness):**
- `oversized_skill` — SKILL.md >10KB (high token cost)

### Report format

Present a compact table showing the current snapshot (skill counts, CLAUDE.md size, memory size, estimated overhead), followed by numbered findings grouped by tier. Use `✓` for pre-selected items and `○` for unselected items.

### Token estimation

System prompt loads skill listings (name + one-line description) at session start, not SKILL.md content. Estimate as:
- Skill listings: `(local_count + plugin_skill_count) × 30` tokens
- CLAUDE.md: `bytes / 4` tokens (loaded in full every session)
- Memory: `total_memory_bytes / 4` tokens (loaded per project)

### User interaction

Ask user which items to disable:
- Enter → accept defaults (Tier 1 only)
- Numbers (e.g., `3,5,7`) → toggle specific items
- `all` → select everything
- `none` → cancel

If subcommand is `scan`, stop here.

---

## Phase 3 — Execute

Run only after user confirmation.

1. `mkdir -p ~/.claude/skills.disabled`
2. Move each selected local skill to `~/.claude/skills.disabled/`
3. Delete individual broken symlinks: `find ~/.claude/skills -type l ! -exec test -e {} \; -delete 2>/dev/null`
4. Clean empty directories left behind: `find ~/.claude/skills -type d -empty -delete 2>/dev/null`
5. If memory files were selected, remove their references from the relevant MEMORY.md
6. Write a manifest line to `~/.claude/skills.disabled/.claude-slim-manifest.jsonl`:
   ```
   {"date":"<ISO>","name":"<skill>","from":"<path>","type":"<issue_type>"}
   ```
   One JSON object per line (JSONL format) — append-safe, no parsing of existing content needed.

---

## Phase 4 — Report

Re-run the scan script, then present a before/after comparison table showing: local skills, system prompt skill count, memory files, and estimated token savings. End with the recovery path (`~/.claude/skills.disabled/`) and the restore command.

---

## Restore

When `/claude-slim restore` is invoked:

1. Read `~/.claude/skills.disabled/.claude-slim-manifest.jsonl`
2. Show numbered list of previously disabled items with dates
3. Ask user which to restore (all or specific numbers)
4. Move selected items back to their original location
5. Append a restore entry to the manifest: `{"date":"<ISO>","name":"<skill>","from":"<path>","action":"restored"}`

---

## Language

Detect the user's language from their most recent message. Present all reports, prompts, and explanations in that language. The scan script output is machine-readable — translate only the user-facing report, not the raw data.

## Rules

1. **Never delete.** Always move to `~/.claude/skills.disabled/`.
2. **Never modify CLAUDE.md or settings.json.**
3. **Never disable plugin-managed skills.** Report only — user manages plugins themselves.
4. **Always confirm before executing.**
5. **If nothing to clean:** respond "Already slim!" and exit.
