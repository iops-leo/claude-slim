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
| **Unused plugins** | **Plugins whose skill/mcp/cmd were never invoked in your last N days of sessions (default 60d). Tier 3, never auto-selected.** |
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

## v2.7.2 — What's new

Correctness patch fixing three HIGH-severity issues from a post-2.7.1 review. No new features; no breaking changes.

- **Friendlier `unused_plugin` cleanup when the `claude` CLI is missing.** Users running claude-slim outside a Claude Code install used to see raw `spawn claude ENOENT` — one row per selected plugin. The cleaner now probes the CLI once up front via `isClaudeCliAvailable()`; failing items become `skipped` (not `errored`), and a single grouped warning points at the manual `claude plugin disable <name>` workaround.
- **Nested-skill scanner now covers 3-deep layouts.** The prior 2-level walk silently missed `skills/<org>/<group>/<skill>/SKILL.md` — token totals under-reported and `unused_skill` could never flag them. Replaced with a bounded recursive walk (`MAX_SKILL_DEPTH = 3`) that stops descending once a `SKILL.md` is found, so nested docs under a declared skill don't become phantom duplicates.
- **`scan --json` output contract locked in.** New test spies on `console.log` / `console.info` / `console.warn` during the full scan pipeline (both minimal and rich fixtures — session logs, plugin cache, memory, CLAUDE.md) and fails if any fires. No stray writes exist today; the invariant is now enforced so a future refactor can't silently break `claude-slim scan --json | jq`.

Tests: 190 → 206 (+16).

For older release notes, see [CHANGELOG.md](CHANGELOG.md).

---

## Requirements

- Node.js 20+
- macOS or Linux
- Claude Code CLI

## License

MIT
