# claude-slim

Reduce Claude Code token overhead in 60 seconds.

[한국어](./docs/README.ko.md) | [日本語](./docs/README.ja.md) | [中文](./docs/README.zh.md)

## Problem

Every Claude Code session starts by loading your full environment into the system prompt: skill descriptions, memory files, tool lists, and plugin instructions. As you install more skills and plugins over time, this overhead grows silently.

| Source | Example overhead |
|--------|-----------------|
| 60+ registered skills | ~3,000 tokens |
| CLAUDE.md (plugin instructions) | ~5,000 tokens |
| Memory files | ~2,500 tokens |
| Deferred tools list | ~1,500 tokens |
| **Total** | **~12,000 tokens/session** |

That's 12K tokens taxed on every single message — before you even say "hello."

This happens with **any** combination of plugins and skills: community skill packs, custom team skills, marketplace plugins, or hand-installed tools. The more you add, the heavier it gets.

## What claude-slim Does

```
/claude-slim
```

A 4-phase pipeline that finds and removes token waste:

**1. Scan** — Measures all token overhead sources: local skills, plugin skills, CLAUDE.md, memory files, MCP servers.

**2. Analyze** — Detects issues automatically:

| Detection | Example |
|-----------|---------|
| Broken symlinks | Leftover links from uninstalled skill packs |
| Duplicate skills | Same skill registered from multiple sources |
| Empty templates | Placeholder skills with no real content |
| Oversized files | SKILL.md files over 10KB |
| Stale memory | Large memory files loaded every session |

**3. Propose** — Shows a categorized report with three tiers:
- **Auto** — Safe to remove (broken symlinks, empty templates). Pre-selected.
- **Recommended** — Likely unused (duplicates, stale files). Suggested.
- **Optional** — Your call (oversized skills, rarely used items). Listed for awareness.

You choose what to disable. Enter to accept defaults, or pick specific items.

**4. Report** — Before/after comparison with estimated token savings.

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

## Install

```bash
claude install gh:iops-leo/claude-slim
```

## Usage

```bash
/claude-slim              # Full pipeline: scan → propose → execute → report
/claude-slim scan         # Report only, no changes
/claude-slim restore      # Undo: restore previously disabled items
```

## Safety

- **Non-destructive.** Nothing is ever deleted. Disabled items are moved to `~/.claude/skills.disabled/`.
- **Reversible.** Run `/claude-slim restore` to bring anything back.
- **User-controlled.** Always asks before making changes. You pick exactly what to disable.
- **Hands off the danger zone.** Never touches CLAUDE.md, settings.json, or plugin configurations.

## What It Won't Do

- Modify your CLAUDE.md (managed by plugins — editing it breaks things)
- Disable plugins or MCP servers (too risky — manage those yourself)
- Delete anything (always moves to `.disabled`)
- Run without your approval (requires explicit confirmation)

## How It Works

claude-slim scans these locations:

| Location | What's there |
|----------|-------------|
| `~/.claude/skills/` | User-installed local skills |
| `~/.claude/plugins/cache/` | Installed plugin skills |
| `~/.claude/CLAUDE.md` | Plugin-injected instructions |
| `~/.claude/projects/*/memory/` | Auto-memory files |
| `~/.claude/settings.json` | MCP server count (read-only) |

It works regardless of which plugins you use. No plugin-specific logic — just filesystem analysis.

## Real-World Results

This tool was born from a real cleanup session where the environment had accumulated skills from multiple sources over months of use:

| Metric | Before | After |
|--------|--------|-------|
| Local skills | 65 | 15 |
| System prompt skills | ~80 | ~48 |
| Memory files | 15KB | 2KB |
| **Est. token savings** | | **~4,300/session** |

## Requirements

- Claude Code CLI
- macOS or Linux

## License

MIT

