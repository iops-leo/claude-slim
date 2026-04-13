#!/usr/bin/env bash
# claude-slim scanner — detects token overhead in Claude Code environments
set -euo pipefail

CLAUDE_DIR="${HOME}/.claude"
SKILLS_DIR="${CLAUDE_DIR}/skills"
PLUGINS_DIR="${CLAUDE_DIR}/plugins/cache"
PROJECTS_DIR="${CLAUDE_DIR}/projects"

echo "=== LOCAL SKILLS ==="
local_count=0
local_total_bytes=0
if [ -d "$SKILLS_DIR" ]; then
  for dir in "$SKILLS_DIR"/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    if [ -f "${dir}SKILL.md" ]; then
      size=$(wc -c < "${dir}SKILL.md" | tr -d ' ')
      echo "SKILL:${name}:${size}"
      local_total_bytes=$((local_total_bytes + size))
      local_count=$((local_count + 1))
    elif [ -L "${dir}SKILL.md" ] && [ ! -e "${dir}SKILL.md" ]; then
      echo "BROKEN_SYMLINK:${name}:$(readlink "${dir}SKILL.md" 2>/dev/null || echo unknown)"
    fi
  done
fi
echo "LOCAL_SUMMARY:${local_count}:${local_total_bytes}"

echo ""
echo "=== PLUGIN SKILLS ==="
if [ -d "$PLUGINS_DIR" ]; then
  for plugin_dir in "$PLUGINS_DIR"/*/; do
    [ -d "$plugin_dir" ] || continue
    pname=$(basename "$plugin_dir")
    # Walk version subdirectories if they exist
    count=$(find "$plugin_dir" -path "*/skills/*/SKILL.md" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$count" -gt 0 ]; then
      echo "PLUGIN:${pname}:${count}"
      # Collect skill names for duplicate detection
      find "$plugin_dir" -path "*/skills/*/SKILL.md" -exec bash -c 'basename "$(dirname "$1")"' _ {} \; 2>/dev/null | while read -r sname; do
        echo "PLUGIN_SKILL:${pname}:${sname}"
      done
    fi
  done
fi

echo ""
echo "=== CLAUDE_MD ==="
if [ -f "${CLAUDE_DIR}/CLAUDE.md" ]; then
  size=$(wc -c < "${CLAUDE_DIR}/CLAUDE.md" | tr -d ' ')
  echo "CLAUDE_MD:${size}"
else
  echo "CLAUDE_MD:0"
fi

echo ""
echo "=== MEMORY FILES ==="
mem_total=0
mem_count=0
if [ -d "$PROJECTS_DIR" ]; then
  while IFS= read -r f; do
    size=$(wc -c < "$f" | tr -d ' ')
    project=$(echo "$f" | sed "s|${PROJECTS_DIR}/||" | cut -d/ -f1)
    fname=$(basename "$f")
    echo "MEMORY:${project}:${fname}:${size}"
    mem_total=$((mem_total + size))
    mem_count=$((mem_count + 1))
  done < <(find "$PROJECTS_DIR" -path "*/memory/*.md" -type f 2>/dev/null)
fi
echo "MEMORY_SUMMARY:${mem_count}:${mem_total}"

echo ""
echo "=== MCP SERVERS ==="
mcp_count=$(python3 -c "
import json
with open('${CLAUDE_DIR}/settings.json') as f:
    d = json.load(f)
print(len(d.get('mcpServers', {})))
" 2>/dev/null || echo "0")
echo "MCP:${mcp_count}"

echo ""
echo "=== ISSUES ==="

# Broken symlinks
find "$SKILLS_DIR" -type l ! -exec test -e {} \; -print 2>/dev/null | while read -r link; do
  dir=$(dirname "$link")
  name=$(basename "$dir")
  target=$(readlink "$link" 2>/dev/null || echo "unknown")
  echo "ISSUE:broken_symlink:${name}:${target}"
done

# Duplicate skills (local name exists in plugin)
if [ -d "$SKILLS_DIR" ] && [ -d "$PLUGINS_DIR" ]; then
  plugin_skill_names=$(find "$PLUGINS_DIR" -path "*/skills/*/SKILL.md" -exec bash -c 'basename "$(dirname "$1")"' _ {} \; 2>/dev/null | sort -u)
  for dir in "$SKILLS_DIR"/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    [ -f "${dir}SKILL.md" ] || continue
    echo "$plugin_skill_names" | grep -qx "$name" 2>/dev/null && echo "ISSUE:duplicate:${name}:local+plugin"
  done
fi

# Empty/template skills
for dir in "$SKILLS_DIR"/*/; do
  [ -d "$dir" ] || continue
  if [ -f "${dir}SKILL.md" ]; then
    if grep -q "Replace with description" "${dir}SKILL.md" 2>/dev/null; then
      echo "ISSUE:template:$(basename "$dir")"
    fi
  fi
done

# .skill duplicate directories
for dir in "$SKILLS_DIR"/*.skill/; do
  [ -d "$dir" ] || continue
  base=$(basename "$dir" .skill)
  [ -d "${SKILLS_DIR}/${base}" ] && echo "ISSUE:skill_dup:${base}"
done

# Oversized skill files (>10KB)
for dir in "$SKILLS_DIR"/*/; do
  [ -d "$dir" ] || continue
  if [ -f "${dir}SKILL.md" ]; then
    name=$(basename "$dir")
    size=$(wc -c < "${dir}SKILL.md" | tr -d ' ')
    [ "$size" -gt 10240 ] && echo "ISSUE:oversized_skill:${name}:${size}"
  fi
done

# Oversized memory files (>5KB)
find "$PROJECTS_DIR" -path "*/memory/*.md" -type f -size +5k 2>/dev/null | while read -r f; do
  size=$(wc -c < "$f" | tr -d ' ')
  project=$(echo "$f" | sed "s|${PROJECTS_DIR}/||" | cut -d/ -f1)
  fname=$(basename "$f")
  echo "ISSUE:oversized_memory:${project}/${fname}:${size}"
done

echo ""
echo "=== DONE ==="
