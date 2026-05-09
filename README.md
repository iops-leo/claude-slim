<div align="center">

# claude-slim

[![npm](https://img.shields.io/npm/v/claude-slim.svg)](https://www.npmjs.com/package/claude-slim)
[![CI](https://github.com/iops-leo/claude-slim/actions/workflows/ci.yml/badge.svg)](https://github.com/iops-leo/claude-slim/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/claude-slim.svg)](./LICENSE)

**You're burning thousands of tokens before you even say "hello."**

Every Claude Code session auto-loads every skill, memory file, and plugin instruction into the system prompt — even the ones you never use. If you run OMC, marketplace plugins, or a custom skill stack, you're paying for context you'll never touch. claude-slim finds and removes that waste.

```
/claude-slim
```

[한국어](./docs/README.ko.md) | [日本語](./docs/README.ja.md) | [中文](./docs/README.zh.md)

</div>

---

### See it in action

<p align="center">
  <img src="docs/demo.gif" alt="claude-slim cleanup: 11,442 tokens of overhead reduced to ~5,800 in 45 seconds" width="900" />
</p>

Where the bloat hides:

| Source | Typical overhead |
|--------|:---:|
| 60+ registered skills | ~3,000 tokens |
| CLAUDE.md (plugin instructions) | ~5,000 tokens |
| Memory files | ~2,500 tokens |
| Deferred tools list | ~1,500 tokens |
| **Total** | **~12,000 tokens** |

That's slower responses. Hitting your usage cap faster. Paying for context you're not using.

---

## One command. Five steps.

```
/claude-slim
```

```
 ┌────────┐   ┌──────────┐   ┌─────────┐   ┌─────────┐   ┌────────┐
 │  Scan  │ → │ Classify │ → │ Propose │ → │  Clean  │ → │ Report │
 │        │   │          │   │         │   │         │   │        │
 │measure │   │ broken   │   │  you    │   │ move to │   │before  │
 │ every  │   │ dupes    │   │ choose  │   │.disabled│   │  vs    │
 │source  │   │ bloat    │   │  what   │   │  dir    │   │ after  │
 └────────┘   └──────────┘   └─────────┘   └─────────┘   └────────┘
```

**Scan** — Measures everything: local skills, plugin skills, CLAUDE.md, memory files, MCP servers. Token counts are measured with [js-tiktoken](https://github.com/nicolo-ribaudo/js-tiktoken), not guessed.

**Classify** — Finds the waste automatically:

| | What it catches |
|---|---|
| Broken symlinks | Dead links from uninstalled skill packs |
| Duplicates | Same skill registered from multiple sources |
| Empty templates | Placeholder skills with no content |
| Oversized files | SKILL.md over 10KB |
| **Unused skills** | **Local skills never invoked in your last N days of sessions (default 60d)** |
| Stale memory | Large memory files loaded every session |
| Disabled plugins | Installed but disabled plugins still in cache |
| Stale projects | Project memory untouched for 90+ days |
| Temp caches | Failed plugin install remnants (`temp_local_*`) |

**Propose** — Three tiers, you decide:

| Tier | Action | Example |
|------|--------|---------|
| **Auto** | Pre-selected | Broken symlinks, empty templates, temp caches |
| **Recommended** | Suggested | Duplicates, stale memory, disabled plugins, stale projects |
| **Optional** | Your call | Oversized skills you might still use |

**Clean** — Moves selected skills and project memory to `~/.claude/skills.disabled/`. Failed-install temp caches and dead symlink files are the only permanent cleanups, and they are labeled before selection.

**Report** — Shows exactly what changed:

```
╭──────────────────────────────────────────╮
│  claude-slim report                      │
│                                          │
│  Before: 14,510 tokens at startup        │
│  After:   5,181 tokens at startup        │
│  Saved:   9,329 tokens (64.3%)           │
│                                          │
│  Top offenders removed:                  │
│  • office-hours              23,008 tok  │
│  • harness                    7,902 tok  │
│  • manpower                   4,764 tok  │
│                                          │
│  Est. monthly savings: ~$1.68            │
│  (2 sessions/day × $0.003/1K tok)        │
╰──────────────────────────────────────────╯

  ┌──────────────────┬──────────┬──────────┬────────────┐
  │                  │  Before  │  After   │  Saved     │
  ├──────────────────┼──────────┼──────────┼────────────┤
  │ Local skills     │    14    │     4    │  -10       │
  │ System prompt    │   ~124   │   ~114   │  -10       │
  │ Memory files     │  19.5KB  │   5.7KB  │  -13.8KB   │
  │ Est. tokens      │ ~14,510  │  ~5,181  │  ~9,329    │
  └──────────────────┴──────────┴──────────┴────────────┘
```

---

## Try it (10 seconds)

No install needed — run once and see what's in your `~/.claude/`:

```bash
npx claude-slim scan
```

Happy with what you see? Make it part of your Claude Code workflow:

```bash
claude plugin marketplace add iops-leo/claude-slim
claude plugin install claude-slim
```

Then just type `/claude-slim` in any session.

---

## Usage

```bash
/claude-slim                          # Full pipeline: scan → propose → clean → report
/claude-slim scan                     # Report only, no changes
/claude-slim scan --json              # Machine-readable JSON output
/claude-slim scan --lookback-days 30  # Treat skills idle for 30+ days as unused
/claude-slim doctor                   # Check scanner prerequisites and data fidelity
/claude-slim restore                  # Bring back anything you disabled
```

CLI equivalents:

```bash
npx claude-slim clean                    # Full pipeline
npx claude-slim clean --dry-run          # See what would happen (no changes)
npx claude-slim clean --auto             # Non-interactive, Tier 1 only (CI/scripts)
npx claude-slim clean --lookback-days N  # Tune the unused-skill detection window
npx claude-slim scan                     # Report only
npx claude-slim doctor                   # Diagnose Node/Claude/session-log readiness
npx claude-slim restore                  # Undo
npx claude-slim report                   # Show savings from last clean
```

---

## Safety first

| | |
|---|---|
| **Non-destructive for user data** | Skills and project memory move to `~/.claude/skills.disabled/` |
| **Reversible where state exists** | `/claude-slim restore` brings moved skills and project memory back |
| **User-controlled** | Interactive runs ask before changes. `--dry-run` previews; `--auto` selects Tier 1 only. |
| **Hands off** | Never touches CLAUDE.md, settings.json, or plugin configs |
| **Scoped** | All operations are refused if the target path escapes `~/.claude/` |

### What claude-slim never touches

- **`~/.claude/CLAUDE.md`** — your system instructions, read-only.
- **`~/.claude/settings.json`** — MCP server config, hooks, and any other settings. Read-only.
- **Plugin internals** (`~/.claude/plugins/config.json`, individual `plugin.json` files) — left alone; use `claude plugin` to manage plugins.
- **Git / project sources** — claude-slim only looks inside `~/.claude/`, never at your code.
- **Anything outside `~/.claude/`** — a path-containment guard refuses destructive ops anywhere else, even if a tampered manifest asked it to.

Only touched: entries under `~/.claude/skills/`, `~/.claude/plugins/cache/temp_local_*`, and `~/.claude/projects/*/memory/`. Skill and memory entries are moved to `skills.disabled/`; broken symlink files are unlinked and `temp_local_*` failed-install caches are removed outright.

---

## How it works

claude-slim scans these locations. No plugin-specific logic — pure filesystem analysis.

```
~/.claude/
├── skills/                  ← user-installed skills
├── plugins/cache/           ← plugin skills
├── CLAUDE.md                ← system instructions (read-only)
├── projects/*/memory/       ← auto-memory files
└── settings.json            ← MCP server count (read-only)
```

Works with any setup: OMC, gstack, marketplace plugins, custom skills, or vanilla Claude Code.

---

## Real-world results

From a real cleanup session:

| Metric | Before | After | |
|--------|:------:|:-----:|---|
| Local skills | 65 | 15 | **-77%** |
| System prompt skills | ~80 | ~48 | **-40%** |
| Memory files | 15KB | 2KB | **-87%** |
| **Est. token savings** | | **~4,300/session** | |

---

## v2.4 — What's new

- **Unused-skill detection** — claude-slim now reads your `~/.claude/projects/*/*.jsonl` session transcripts, finds every `Skill` tool invocation in the last 60 days, and flags local skills you've installed but never actually used. Tier 3 (Optional, never auto-selected) so you decide. Configurable lookback via `--lookback-days <n>`. Falls back silently if there's not enough session history (≥3 sessions required) — no false-flagging when the data source is unreliable.
- **Plugin skills are intentionally out of scope** for this detector. They live inside `~/.claude/plugins/cache/` and are managed by the Claude Code plugin runtime; moving them would partially uninstall the plugin. Use `claude plugin disable <name>` for plugin-level cleanup.
- **Per-file session-usage cache** at `~/.claude/.skill-usage-cache.json` keyed by mtime. Warm rescans only re-parse session logs that have changed.
- **Node 20+** is now the engine floor (previously `>=18`, but Node 18 was already dropped from CI in v2.3.0).

## v2.3 — What's new

- **Detector registry refactor (v2.3.0)** — Scanner split from a 588-line module into focused detectors under `src/scanner/`. Adding a new heuristic is a one-function addition; see CONTRIBUTING.md. Public API unchanged.
- **Path-containment guard (v2.2.3)** — Every destructive op refuses any target path that escapes `~/.claude/`. `runCommand` no longer goes through a shell. `temp_cache` cleanup is symlink-safe.
- **Report sign fix (v2.2.3)** — The breakdown table's Saved column was inverted in earlier 2.2.x; cleanup now shows correct savings per row.
- **85 tests (was 73)** — New round-trip coverage for path containment, restore guards, breakdown sign, restore-selection dedup, atomic tokenizer flush, and custom detector injection.

## v2.2 — What's new

- **Atomic `stale_project` clean/restore** — Single directory `rename()` instead of per-file loop. No more partial-failure state if the operation is interrupted.
- **Clear collision errors** — Cleaning a project whose backup already exists (or restoring onto an existing directory) now fails with an actionable message instead of a cryptic OS error.
- **Manifest schema v2** — Single JSON file (`manifest.json`) containing only currently-disabled entries. Restore removes the entry entirely, so the manifest stays bounded across many clean/restore cycles.
- **Automatic migration from v1** — Existing legacy manifests (`.claude-slim-manifest.jsonl`) are auto-migrated on first read; the original is preserved as `.jsonl.bak` for safety.
- **Crash-safe manifest writes** — Write-to-tmp-then-rename pattern prevents partial-write corruption on power loss or SIGKILL.
- **Expanded test coverage** — 66 tests (was 35). New round-trip tests per issue type: `broken_symlink`, `template`, `duplicate`, `skill_dup`, `oversized_skill`, `temp_cache`, `stale_project`. Plus manifest migration + bounded-growth cycle tests.

## v2.0 — What's new

- **TypeScript CLI** — Rewritten from bash. Faster, more accurate, extensible.
- **Accurate token counting** — [js-tiktoken](https://github.com/nicolo-ribaudo/js-tiktoken) with `cl100k_base` encoding.
- **Savings report box** — Visual before/after with breakdown table and monthly savings estimate.
- **`--dry-run`** — Preview changes without making them.
- **`--json`** — Machine-readable output for automation.
- **Token cache** — Instant repeat scans.
- **Standalone CLI** — `npx claude-slim` works outside Claude Code.
- **`--auto`** — Non-interactive cleanup for CI/scripts (Tier 1 only).
- **Disabled plugin detection** — Finds plugins you disabled but didn't uninstall.
- **Stale project detection** — Flags project memory untouched for 90+ days.
- **CLAUDE.md section breakdown** — See which plugin instructions cost the most tokens.
- **Plugin status** — Shows enabled/disabled status for each plugin.
- **Non-TTY support** — Auto-selects Tier 1 when stdin is piped.
- **Unit tests** — Vitest-based.

---

## Requirements

- Node.js 20+
- macOS or Linux
- Claude Code CLI

## License

MIT
