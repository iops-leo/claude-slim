<div align="center">

# claude-slim

**You're burning thousands of tokens before you even say "hello."**

Every session loads *every* skill, memory file, and plugin instruction into the system prompt — even the ones you never use. claude-slim finds and removes that waste.

```
/claude-slim
```

[한국어](./docs/README.ko.md) | [日本語](./docs/README.ja.md) | [中文](./docs/README.zh.md)

</div>

---

### The problem, visualized

```
  Session start token budget
  ┌──────────────────────────────────────────────────┐
  │██████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░│ Before claude-slim
  │ 12K tokens consumed ↑    your actual work ↑      │
  ├──────────────────────────────────────────────────┤
  │██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ After claude-slim
  │ 5K ↑            more room for your work ↑        │
  └──────────────────────────────────────────────────┘
```

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
| Stale memory | Large memory files loaded every session |

**Propose** — Three tiers, you decide:

| Tier | Action | Example |
|------|--------|---------|
| **Auto** | Pre-selected | Broken symlinks, empty templates |
| **Recommended** | Suggested | Duplicates, stale memory |
| **Optional** | Your call | Oversized skills you might still use |

**Clean** — Moves selected items to `~/.claude/skills.disabled/`. **Nothing is deleted. Ever.**

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

## Install (10 seconds)

```bash
claude plugin marketplace add iops-leo/claude-slim
claude plugin install claude-slim
```

Then just type `/claude-slim` in any session.

Or use the standalone CLI:

```bash
npx claude-slim scan
```

---

## Usage

```bash
/claude-slim              # Full pipeline: scan → propose → clean → report
/claude-slim scan         # Report only, no changes
/claude-slim scan --json  # Machine-readable JSON output
/claude-slim restore      # Bring back anything you disabled
```

CLI equivalents:

```bash
npx claude-slim clean             # Full pipeline
npx claude-slim clean --dry-run   # See what would happen (no changes)
npx claude-slim scan              # Report only
npx claude-slim restore           # Undo
npx claude-slim report            # Show savings from last clean
```

---

## Safety first

| | |
|---|---|
| **Non-destructive** | Nothing is ever deleted. Disabled items move to `~/.claude/skills.disabled/` |
| **Reversible** | `/claude-slim restore` brings anything back, any time |
| **User-controlled** | Always asks before making changes. `--dry-run` to preview. |
| **Hands off** | Never touches CLAUDE.md, settings.json, or plugin configs |

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

## v2.0 — What's new

- **TypeScript CLI** — Rewritten from bash. Faster, more accurate, extensible.
- **Accurate token counting** — [js-tiktoken](https://github.com/nicolo-ribaudo/js-tiktoken) instead of bytes/4 guessing.
- **Savings report box** — Visual before/after with breakdown table and monthly savings estimate.
- **`--dry-run`** — Preview changes without making them.
- **`--json`** — Machine-readable output for automation.
- **Token cache** — Instant repeat scans.
- **Standalone CLI** — `npx claude-slim` works outside Claude Code.

---

## Requirements

- Node.js 18+
- macOS or Linux
- Claude Code CLI

## License

MIT
