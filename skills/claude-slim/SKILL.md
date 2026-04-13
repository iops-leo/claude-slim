---
name: claude-slim
description: "Analyze and reduce Claude Code token overhead. Scans skills, plugins, memory files, and CLAUDE.md for bloat — then cleans up with user approval. Use when: /claude-slim, token optimization, reduce tokens, slim down, cleanup skills, token diet"
---

# claude-slim — Token Overhead Reducer

You are running the claude-slim pipeline. This skill analyzes the user's Claude Code environment for token waste and performs non-destructive cleanup with user approval.

## Subcommands

Detect which subcommand the user invoked:
- `/claude-slim` or `/claude-slim run` → full pipeline (scan → propose → execute → report)
- `/claude-slim scan` → Phase 1 + 2 only (report, no changes)
- `/claude-slim restore` → restore previously disabled items from `~/.claude/skills.disabled/`

---

## Phase 1 — Scan & Measure

Collect the "before" snapshot. Run ALL of the following measurements:

### 1.1 Local Skills
```bash
# Count and list all local skills
ls -d ~/.claude/skills/*/ 2>/dev/null | wc -l
```
For each skill directory, measure its SKILL.md size:
```bash
for dir in ~/.claude/skills/*/; do
  if [ -f "${dir}SKILL.md" ]; then
    size=$(wc -c < "${dir}SKILL.md" | tr -d ' ')
    echo "${dir##*/}: ${size} bytes"
  fi
done | sort -t: -k2 -rn
```

### 1.2 Plugin Skills
```bash
# Count skills from each installed plugin
for plugin_dir in ~/.claude/plugins/cache/*/; do
  name=$(basename "$plugin_dir")
  count=$(find "$plugin_dir" -name "SKILL.md" 2>/dev/null | wc -l | tr -d ' ')
  [ "$count" -gt 0 ] && echo "$name: $count skills"
done
```

### 1.3 CLAUDE.md Size
```bash
wc -c ~/.claude/CLAUDE.md 2>/dev/null | awk '{print $1}'
```
Estimate tokens as `bytes / 4`.

### 1.4 Memory Files
```bash
find ~/.claude/projects/*/memory/ -name "*.md" -exec wc -c {} + 2>/dev/null
```

### 1.5 MCP Servers
```bash
python3 -c "
import json
with open('$HOME/.claude/settings.json') as f:
    d = json.load(f)
print(len(d.get('mcpServers', {})))
" 2>/dev/null || echo "0"
```

### 1.6 Detect Issues

**Broken symlinks:**
```bash
find ~/.claude/skills -type l ! -exec test -e {} \; -print 2>/dev/null
```

**Duplicate skills** (same skill name from local + plugin):
```bash
# Get local skill names
local_skills=$(ls ~/.claude/skills/ 2>/dev/null)
# Get plugin skill names
for plugin_dir in ~/.claude/plugins/cache/*/; do
  find "$plugin_dir" -name "SKILL.md" -exec dirname {} \; 2>/dev/null | xargs -I{} basename {}
done | sort -u > /tmp/claude-slim-plugin-skills.txt
# Find overlaps
for s in $local_skills; do
  grep -qx "$s" /tmp/claude-slim-plugin-skills.txt 2>/dev/null && echo "DUPLICATE: $s"
done
```

**Empty/template skills:**
```bash
for dir in ~/.claude/skills/*/; do
  if [ -f "${dir}SKILL.md" ]; then
    if grep -q "Replace with description" "${dir}SKILL.md" 2>/dev/null; then
      echo "TEMPLATE: ${dir##*/}"
    fi
  fi
done
```

**Oversized skill files (>10KB):**
```bash
for dir in ~/.claude/skills/*/; do
  if [ -f "${dir}SKILL.md" ]; then
    size=$(wc -c < "${dir}SKILL.md" | tr -d ' ')
    [ "$size" -gt 10240 ] && echo "OVERSIZED: ${dir##*/} (${size} bytes)"
  fi
done
```

**Oversized memory files (>5KB):**
```bash
find ~/.claude/projects/*/memory/ -name "*.md" -size +5k 2>/dev/null
```

Store all results as the "before" snapshot for the final report.

---

## Phase 2 — Analyze & Propose

Present findings to the user in a structured report with three tiers:

### Tier 1 — Auto-recommended (safe to remove)
Items that are definitively waste. Pre-selected for removal.
- Broken symlinks
- Empty/template skills (description contains "Replace with")
- `.skill` duplicate directories (e.g., `foo.skill/` when `foo/` exists)

### Tier 2 — Recommended (likely unused)
Items that are probably waste. Suggested but not pre-selected.
- Duplicate skills (local copy of something a plugin already provides)
- Oversized memory files (>5KB that are rarely referenced)

### Tier 3 — Optional (user decides)
Items that may or may not be useful. Listed for awareness.
- Skills with SKILL.md > 10KB (high token cost per skill)
- Skills the user hasn't mentioned or invoked in this session

### Display Format

Present findings like this:

```
╔══════════════════════════════════════════════════════════════╗
║                   claude-slim scan report                    ║
╠══════════════════════════════════════════════════════════════╣
║ BEFORE SNAPSHOT                                              ║
║   Local skills:     42                                       ║
║   Plugin skills:    35 (OMC: 30, kakaoent: 5)               ║
║   CLAUDE.md:        ~5,000 tokens                           ║
║   Memory files:     3 files, 15KB                           ║
║   MCP servers:      4                                        ║
║   Est. overhead:    ~8,500 tokens/session                   ║
╠══════════════════════════════════════════════════════════════╣
║ FINDINGS                                                     ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║ [AUTO] Broken symlinks (5 items)                            ║
║   ✓ 1. browse/SKILL.md → gstack/browse (broken)            ║
║   ✓ 2. qa/SKILL.md → gstack/qa (broken)                    ║
║   ...                                                        ║
║                                                              ║
║ [RECOMMENDED] Duplicates (2 items)                          ║
║   ○ 6. git-workflow (local = kakaoent duplicate)            ║
║   ○ 7. code-review (local = kakaoent duplicate)             ║
║                                                              ║
║ [OPTIONAL] Oversized skills (3 items)                       ║
║   ○ 8. harness (28KB)                                       ║
║   ○ 9. pptx (25KB)                                         ║
║   ○ 10. algorithmic-art (20KB)                              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

Where:
- `✓` = pre-selected (AUTO tier)
- `○` = not selected (user can opt in)

Then ask the user:
> **Which items should I disable?**
> - Press Enter to accept defaults (auto-selected items only)
> - Type numbers to toggle: e.g., `6,7,8` to also include those
> - Type `all` to select everything
> - Type `none` to cancel

If subcommand is `scan`, stop here. Do NOT proceed to Phase 3.

---

## Phase 3 — Execute

Only runs if the user confirmed in Phase 2.

### 3.1 Prepare backup directory
```bash
mkdir -p ~/.claude/skills.disabled
```

### 3.2 Move selected items

For each selected item, move it to the disabled directory:
```bash
# For local skills
mv ~/.claude/skills/<name> ~/.claude/skills.disabled/

# For broken symlink directories — remove the directory entirely
rm -rf ~/.claude/skills/<name>
```

### 3.3 Clean broken symlinks

Remove any directories that only contain broken symlinks:
```bash
find ~/.claude/skills -type l ! -exec test -e {} \; -delete 2>/dev/null
# Remove empty directories left behind
find ~/.claude/skills -type d -empty -delete 2>/dev/null
```

### 3.4 Clean memory index

If any memory files were disabled, update MEMORY.md:
- Read the current MEMORY.md
- Remove lines referencing deleted/moved files
- Write the updated MEMORY.md

### 3.5 Write manifest

Save a record of what was changed for `/claude-slim restore`:
```bash
# Append to manifest
cat >> ~/.claude/skills.disabled/.claude-slim-manifest.json << 'EOF'
{
  "date": "<ISO timestamp>",
  "items": [
    {"name": "<skill>", "from": "<original path>", "type": "<broken-symlink|duplicate|oversized|template>"}
  ]
}
EOF
```

---

## Phase 4 — Report

Show before/after comparison:

```
╔══════════════════════════════════════════════════════════════╗
║                   claude-slim results                        ║
╠════════════════╤═══════════╤═══════════╤════════════════════╣
║                │  Before   │   After   │  Saved             ║
╠════════════════╪═══════════╪═══════════╪════════════════════╣
║ Local skills   │    42     │    15     │  -27               ║
║ System prompt  │   ~80     │   ~48     │  -32 skills        ║
║ Memory files   │   15KB    │    2KB    │  -13KB             ║
║ Est. tokens    │  ~8,500   │  ~4,200   │  ~4,300 saved      ║
╠════════════════╧═══════════╧═══════════╧════════════════════╣
║                                                              ║
║ Disabled items → ~/.claude/skills.disabled/                 ║
║ Run /claude-slim restore to undo any changes                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

---

## Restore Subcommand

When the user runs `/claude-slim restore`:

1. Read `~/.claude/skills.disabled/.claude-slim-manifest.json`
2. Show the user what was previously disabled (with dates)
3. Ask which items to restore (all or specific numbers)
4. Move items back from `~/.claude/skills.disabled/` to their original locations
5. Update the manifest to mark items as restored

---

## Important Rules

1. **Never delete files.** Always move to `.disabled` directories.
2. **Never modify CLAUDE.md.** It's managed by plugins and manual edits break things.
3. **Never modify settings.json.** Don't touch enabledPlugins or mcpServers.
4. **Never disable plugin-managed skills.** Only report on them — the user must manage plugins themselves.
5. **Always ask before executing.** Phase 3 requires explicit user confirmation.
6. **Handle empty environments gracefully.** If there's nothing to clean, say "Already slim!" and exit.
7. **Use `~/.claude/skills.disabled/`** as the single recovery location for all disabled items.
