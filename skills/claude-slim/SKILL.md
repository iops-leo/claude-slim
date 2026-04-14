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

## Execution

Run the CLI via Node.js. The CLI handles all scanning, classification, user interaction, and cleanup.

```bash
cd "${CLAUDE_PLUGIN_ROOT}" && node dist/cli.js <subcommand>
```

If `CLAUDE_PLUGIN_ROOT` is not set, locate it via:
```bash
PLUGIN_DIR=$(find ~/.claude/plugins -path "*/claude-slim/dist/cli.js" -type f 2>/dev/null | head -1 | xargs dirname | xargs dirname)
node "${PLUGIN_DIR}/dist/cli.js" <subcommand>
```

Subcommand mapping:
- `/claude-slim` or `/claude-slim run` → `node dist/cli.js clean`
- `/claude-slim scan` → `node dist/cli.js scan`
- `/claude-slim scan --json` → `node dist/cli.js scan --json`
- `/claude-slim restore` → `node dist/cli.js restore`

If `node` is not available, fall back to the legacy bash scanner:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/claude-slim/scripts/scan.sh"
```

---

## What the CLI does

**Scan**: Measures local skills, plugin skills, CLAUDE.md, memory files, MCP servers. Uses js-tiktoken for token counting (falls back to bytes/4 if unavailable).

**Clean**: Shows issues in 3 tiers, then asks the user to confirm:
- **Tier 1 (Auto)**: Broken symlinks, empty templates, .skill/ duplicates, `temp_local_*` cache directories — pre-selected
- **Tier 2 (Recommended)**: Local/plugin duplicates, oversized memory, disabled plugins still occupying cache — suggested. Show `claude plugin uninstall <name>` for disabled plugins.
- **Tier 3 (Optional)**: Oversized skills (>10KB) — informational

For the plugin summary, annotate each plugin with its status: e.g., `OMC: 36 skills (enabled)`, `pm-skills: 65 skills (disabled)`. This helps users spot plugins they forgot to uninstall.

After cleanup, shows a savings report box with before/after token counts and monthly savings estimate.

**Restore**: Reads the JSONL manifest and lets the user restore previously disabled items.

---

## Language

Detect the user's language from their most recent message. Present all prompts and explanations in that language.

## Rules

1. **Never delete.** The CLI moves items to `~/.claude/skills.disabled/`.
2. **Never modify CLAUDE.md or settings.json.**
3. **Never disable plugin-managed skills.** Report only.
4. **Always confirm before executing.** Use `--dry-run` to preview changes.
5. **If nothing to clean:** respond "Already slim!" and exit.
