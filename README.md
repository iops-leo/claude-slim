<div align="center">

# claude-slim

**Your Claude Code is burning tokens before you even say "hello."**

Every session loads *every* skill, memory file, and plugin instruction into the system prompt — even the ones you never use. claude-slim finds and removes that waste.

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

---

## One command. Four phases.

```
/claude-slim
```

```
 ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
 │  Scan   │ →  │ Analyze │ →  │ Propose │ →  │ Report  │
 │         │    │         │    │         │    │         │
 │ measure │    │ broken  │    │ you     │    │ before  │
 │ every   │    │ dupes   │    │ choose  │    │ vs      │
 │ source  │    │ bloat   │    │ what    │    │ after   │
 └─────────┘    └─────────┘    └─────────┘    └─────────┘
```

**Scan** — Measures everything: local skills, plugin skills, CLAUDE.md, memory files, MCP servers.

**Analyze** — Finds the waste automatically:

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

**Report** — Shows exactly what changed:

```
┌────────────────┬──────────┬──────────┬────────────┐
│                │  Before  │  After   │  Saved     │
├────────────────┼──────────┼──────────┼────────────┤
│ Local skills   │    65    │    15    │  -50       │
│ System prompt  │   ~80    │   ~48    │  -32       │
│ Memory files   │   15KB   │    2KB   │  -13KB     │
│ Est. tokens    │  ~8,500  │  ~4,200  │  ~4,300    │
└────────────────┴──────────┴──────────┴────────────┘
```

---

## Install

```bash
claude plugin marketplace add iops-leo/claude-slim
claude plugin install claude-slim
```

## Usage

```bash
/claude-slim              # Full pipeline
/claude-slim scan         # Report only, no changes
/claude-slim restore      # Undo everything
```

---

## Safety first

| | |
|---|---|
| **Non-destructive** | Nothing is ever deleted. Disabled items move to `~/.claude/skills.disabled/` |
| **Reversible** | `/claude-slim restore` brings anything back |
| **User-controlled** | Always asks before making changes |
| **Hands off** | Never touches CLAUDE.md, settings.json, or plugin configs |

---

## How it works

claude-slim scans these locations. No plugin-specific logic — pure filesystem analysis.

```
~/.claude/
├── skills/                  ← user-installed skills
├── plugins/cache/           ← plugin skills
├── CLAUDE.md                ← plugin instructions (read-only)
├── projects/*/memory/       ← auto-memory files
└── settings.json            ← MCP server count (read-only)
```

Works with any plugin combination: OMC, gstack, custom skills, marketplace plugins, or none at all.

---

## Real-world results

From a real cleanup session where skills accumulated over months:

| Metric | Before | After | |
|--------|:------:|:-----:|---|
| Local skills | 65 | 15 | **-77%** |
| System prompt skills | ~80 | ~48 | **-40%** |
| Memory files | 15KB | 2KB | **-87%** |
| **Est. token savings** | | **~4,300/session** | |

---

## Requirements

- Claude Code CLI
- macOS or Linux

## License

MIT
