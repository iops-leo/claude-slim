<div align="center">

# claude-slim

[![npm](https://img.shields.io/npm/v/claude-slim.svg)](https://www.npmjs.com/package/claude-slim)
[![downloads](https://img.shields.io/npm/dm/claude-slim.svg)](https://www.npmjs.com/package/claude-slim)
[![CI](https://github.com/iops-leo/claude-slim/actions/workflows/ci.yml/badge.svg)](https://github.com/iops-leo/claude-slim/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/claude-slim.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/claude-slim.svg)](./LICENSE)
[![skills.sh](https://skills.sh/b/iops-leo/claude-slim)](https://skills.sh/iops-leo/claude-slim)

**Your Claude Code session burns thousands of tokens before you even say "hello."**

Every session auto-loads every skill, agent, slash command, memory file, and plugin instruction into the system prompt — even the ones you never use. If you run OMC, marketplace plugins, or a custom skill stack, you're paying for context you'll never touch on every single turn. claude-slim measures that startup overhead and removes what you don't need.

No proxy, no compression, no changes to how Claude Code talks to the API — it reads `~/.claude/`, tells you what each skill and plugin actually costs, and moves the dead weight aside reversibly.

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

Where the bloat hides — what Claude Code actually sent at the start of one real session, read back from its own session log:

| Source | What it costs | |
|--------|:---:|---|
| MCP tool names | ~10,700 tokens | 768 names. Tool search defers the schemas, not the names — one connector alone listed 160 |
| Skill listing | ~8,200 tokens | 213 skills, capped at 1% of the context window — **99 of them shown by name only** |
| Instruction files | ~6,300 tokens | CLAUDE.md, `@path` imports, rules without `paths:`, the project's `MEMORY.md` |
| MCP server instructions | ~3,600 tokens | 10 servers, claude.ai connectors included |
| Agent catalog | ~2,200 tokens | 33 agents |

The skill listing has a budget: 1% of the context window (6,000 characters on a 200k model, 30,000 on 1M). Past it, Claude Code doesn't grow the prompt — it quietly drops descriptions, starting with the skills you use least. Those skills are still installed and still invocable, but the model only sees `- skill-name`, so it can't tell when to reach for them. On the install above, nearly half the skills were in that state.

That's slower responses. Hitting your usage cap faster. Paying for context you're not using — on every turn, of every session.

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
| Agents & commands | `~/.claude/agents/` and `~/.claude/commands/` — measured and reported, never modified |
| Rules & imports | `~/.claude/rules/` and CLAUDE.md `@path` imports — measured and reported, never modified |
| **Unused plugins** | **Plugins whose skill/mcp/cmd were never invoked in your last N days of sessions (default 60d). Tier 3, never auto-selected.** |
| **Unused MCP servers** | **User- and local-scope servers in `~/.claude.json` whose tools were never called in your last N days. Tier 3, never auto-selected. Removed with `claude mcp remove`; the definition is kept for `restore`.** |
| Oversized memory index | `MEMORY.md` over 5KB, or cut at the 200-line / 25KB startup cap so its tail never loads |
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
╭────────────────────────────────────────╮
│  claude-slim report                    │
│                                        │
│  Before: 14,510 tokens at startup      │
│  After:   5,181 tokens at startup      │
│  Saved:   9,329 tokens (64.3%)         │
│                                        │
│  Top offenders removed:                │
│  • office-hours              23,008 tok│
│  • harness                    7,902 tok│
│  • manpower                   4,764 tok│
│                                        │
│  Est. monthly savings: ~$1.68          │
│  (2 sessions/day × $0.003/1K tok)      │
╰────────────────────────────────────────╯

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

Or install it through the [skills.sh](https://skills.sh) directory, which can also place
the skill into Codex, Cursor, and OpenCode. What claude-slim *analyzes* is unchanged:
`~/.claude/` and `~/.codex/`.

```bash
npx skills add iops-leo/claude-slim
```

---

## Usage

```bash
/claude-slim                          # Full pipeline: scan → propose → clean → report
/claude-slim scan                     # Report only, no changes
/claude-slim scan --json              # Machine-readable JSON output
/claude-slim scan --lookback-days 30  # Treat skills idle for 30+ days as unused
/claude-slim scan --project-dir PATH  # Count PATH's project memory (default: cwd)
/claude-slim doctor                   # Check scanner prerequisites and data fidelity
/claude-slim check-update             # Is a newer version published?
/claude-slim restore                  # Bring back anything you disabled
```

CLI equivalents:

```bash
npx claude-slim clean                    # Full pipeline
npx claude-slim clean --dry-run          # See what would happen (no changes)
npx claude-slim clean --auto             # Non-interactive, Tier 1 only (CI/scripts)
npx claude-slim clean --lookback-days N  # Tune the unused-skill detection window
npx claude-slim scan                     # Report only
npx claude-slim scan --no-codex          # Skip the ~/.codex scan
npx claude-slim doctor                   # Diagnose Node/Claude/session-log readiness
npx claude-slim doctor --offline         # Same, without the version check (no network)
npx claude-slim check-update             # Report-only version check
npx claude-slim update                   # Run the upgrade for this install method
npx claude-slim restore                  # Undo
npx claude-slim report                   # Show savings from last clean
```

### Staying current

An outdated claude-slim doesn't just miss features — it reports **wrong numbers**. Versions before 2.8.0 inflated the startup estimate roughly 8×, and nothing told you that you were behind.

`doctor` now compares your installed version against npm and prints the upgrade command for how you actually installed it:

```
! Version: 2.0.0 installed, 2.8.1 available
    Outdated versions report wrong token totals. Update with:
    claude plugin marketplace update claude-slim && claude plugin update claude-slim@claude-slim
```

claude-slim never updates itself — that's your package manager's job, and writing into a directory `claude plugin` owns is how installs get corrupted. It only tells you. The check is the tool's only outbound request, is skipped with `--offline`, caches for 24h, and fails open when you're offline.

---

## Safety first

| | |
|---|---|
| **Non-destructive for user data** | Skills and project memory move to `~/.claude/skills.disabled/` |
| **Reversible where state exists** | `/claude-slim restore` brings moved skills, project memory and removed MCP servers back |
| **User-controlled** | Interactive runs ask before changes. `--dry-run` previews; `--auto` selects Tier 1 only. |
| **Hands off** | Never touches CLAUDE.md, settings.json, or plugin configs |
| **Scoped** | All operations are refused if the target path escapes `~/.claude/` |
| **MCP through Claude Code** | `~/.claude.json` is never edited by hand. Selected MCP servers are removed with `claude mcp remove`, their definitions backed up (mode 0600) to `~/.claude/skills.disabled/.mcp-backup/` |

### What claude-slim never touches

- **`~/.claude/CLAUDE.md`** — your system instructions, read-only.
- **`~/.claude/settings.json`** — MCP server config, hooks, and any other settings. Read-only.
- **`~/.claude/agents/` and `~/.claude/commands/`** — measured and reported since v2.8, never moved or deleted. There is no restore path for them yet, and a destructive action without its undo isn't worth shipping.
- **`~/.claude.json`** — never written directly. An `unused_mcp` item you select is removed through `claude mcp remove`, and `restore` puts it back with `claude mcp add-json`. Project servers in a repo's `.mcp.json` are reported, never removed.
- **Plugin internals** (`~/.claude/plugins/config.json`, individual `plugin.json` files) — left alone; use `claude plugin` to manage plugins.
- **Git / project sources** — claude-slim only looks inside `~/.claude/`, never at your code.
- **`~/.codex/`** — scanned and, since v2.11, cleanable under the same tiers. Moves go to `~/.codex/skills.disabled/` and reverse with `restore`. The path guard is per-agent, so a Codex item can never resolve into `~/.claude/`. Unused-skill detection is still not offered there: Codex session logs record the skill catalog, not invocations, so there is no honest usage signal to act on.
- **Anything outside `~/.claude/`** — a path-containment guard refuses destructive ops anywhere else, even if a tampered manifest asked it to.

Only touched: entries under `~/.claude/skills/`, `~/.claude/plugins/cache/temp_local_*`, and `~/.claude/projects/*/memory/`, plus the MCP servers you select (via the `claude` CLI). Skill and memory entries are moved to `skills.disabled/`; broken symlink files are unlinked and `temp_local_*` failed-install caches are removed outright.

---

## How it works

claude-slim scans these locations. No plugin-specific logic — pure filesystem analysis.

```
~/.claude/
├── skills/                  ← user-installed skills
├── plugins/cache/           ← plugin skills, agents, commands, MCP servers
├── agents/                  ← user agents (measured, read-only)
├── commands/                ← user slash commands (measured, read-only)
├── CLAUDE.md                ← system instructions + @imports (read-only)
├── rules/                   ← user rules (measured, read-only; path-scoped ones listed separately)
├── projects/*/memory/       ← auto-memory (only the current project's MEMORY.md counts toward startup)
├── projects/*/*.jsonl       ← session logs: what you invoke, and what the newest session loaded (read-only)
└── settings.json            ← settings (read-only; MCP servers defined here are flagged as not loaded)
~/.claude.json               ← user and local MCP servers
<project>/.mcp.json          ← project MCP servers (read-only)
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

### A note on the numbers

claude-slim reports what a session in **this** directory pays. Memory is per-project — Claude Code loads `~/.claude/projects/<slug>/memory/` for the project you're in, not every project on disk — so running `scan` from two different repos will legitimately give you two different totals. Within that project only `MEMORY.md` is loaded at startup, and only its first 200 lines or 25KB; topic files cost nothing until Claude reads one.

Token counts come from [js-tiktoken](https://github.com/nicolo-ribaudo/js-tiktoken) against the actual file contents. The only estimates left are marked with `~`: MCP tool schemas (~8 tokens/tool) and skills whose frontmatter can't be parsed (~30 tokens). Everything else is measured.

**MEASURED AT SESSION START** goes one step further: it reads the startup context Claude Code recorded in your newest session log, so it covers what disk analysis can't see — claude.ai connectors, MCP tool names, and which skills were cut to a bare name. When the skill listing is over budget, the estimate counts it at the budget, and `RECOVERABLE` says so: removing skills from an over-budget listing brings descriptions back instead of shrinking the prompt.

---

## v2.17.0 — What's new

- **Added: MEASURED AT SESSION START.** `scan` reads the startup context Claude Code recorded in your newest session log — skill listing, MCP tool names, server instructions, agent catalog, instruction files — and reports:
  - **skills shown by name only.** The listing is capped at 1% of the context window; past it, descriptions are dropped from the least-used skills. They are listed, grouped by plugin, with how many descriptions cleaning the unused ones would bring back.
  - **one connector added twice** — two MCP servers exposing the same tool names (e.g. a claude.ai connector and a manual install), and tool names two servers both expose.
  - the first turn's real input size, Claude Code's own prompt included.
- **Changed: the estimate follows the listing budget.** An over-budget skill listing is counted at its budget, and `RECOVERABLE` no longer promises tokens that removing skills from it can't free.
- **Fixed: unused detection.** Skills typed as `/name` and plugins used only through `/plugin:command` were reported unused. Claude Code's own `skillUsage` record now counts as use too. "Not invoked in 60d" claimed more than the logs hold — Claude Code deletes them after 30 days by default — so findings now say how many days of logs they rest on, and `doctor` tells you how to keep more.
- **Fixed: restore and safety.** Restoring a Codex skill could drop the record of a Claude skill with the same name. A corrupt `manifest.json` was silently overwritten. A symlinked folder under `skills/` let clean move files outside `~/.claude/`. All three are closed.
- Also fixed: active projects offered as stale, plugin state judged per marketplace instead of per plugin, `clean --dry-run` refusing to run without a TTY, inflated after-clean figures with `--project-dir`, `CODEX_HOME` ignored.

Tests: 580 → 703.

For older release notes, see [CHANGELOG.md](CHANGELOG.md).

---

## Requirements

- Node.js 20+
- macOS or Linux
- Claude Code CLI

## License

MIT
