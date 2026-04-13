# claude-slim

Reduce Claude Code token overhead in 60 seconds.

## Problem

As you install plugins, skills, and MCP servers in Claude Code, your system prompt grows silently. Each session starts by loading **every** registered skill description, memory file, and tool list — even ones you never use.

A typical bloated setup:

| Source | Example overhead |
|--------|-----------------|
| 60+ skills (gstack, OMC, custom) | ~3,000 tokens |
| CLAUDE.md (plugin instructions) | ~5,000 tokens |
| Memory files | ~2,500 tokens |
| Deferred tools list | ~1,500 tokens |
| **Total** | **~12,000 tokens/session** |

That's 12K tokens taxed on every single message — before you even say "hello."

## What claude-slim Does

```
/claude-slim
```

A 4-phase pipeline that finds and removes token waste:

**1. Scan** — Measures all token overhead sources: local skills, plugin skills, CLAUDE.md, memory files, MCP servers.

**2. Analyze** — Detects issues automatically:
| Detection | Example |
|-----------|---------|
| Broken symlinks | Leftover links after removing a skill pack |
| Duplicate skills | Same skill from local install AND a plugin |
| Empty templates | Placeholder skills with no real content |
| Oversized files | SKILL.md files over 10KB |
| Stale memory | Large memory files loaded every session |

**3. Propose** — Shows a categorized report with three tiers:
- **Auto** — Safe to remove (broken symlinks, empty templates). Pre-selected.
- **Recommended** — Likely unused (duplicates). Suggested.
- **Optional** — Your call (oversized skills). Listed for awareness.

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
- Run without your approval (Phase 3 requires explicit confirmation)

## Real-World Example

This tool was born from a real cleanup session. The setup had:
- **gstack** installed with 191 skill files, most as symlinks
- **35 broken symlinks** left after partial removal
- **Duplicate skills** registered from both local install and a plugin
- **10KB memory file** loaded into every session

After running claude-slim: system prompt skills dropped from **~80 to ~48**, local skills from **65 to 15**, saving an estimated **~4,000 tokens per session**.

## Requirements

- Claude Code CLI
- macOS or Linux (uses standard POSIX tools)

## License

MIT

---

Built with [Claude Code](https://claude.ai/claude-code)
