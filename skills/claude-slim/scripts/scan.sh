#!/usr/bin/env bash
# claude-slim scanner — detects token overhead in Claude Code environments
set -euo pipefail

OUTPUT_FORMAT="${1:-text}"  # text (default) or json
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# JSON mode: re-run in text mode, pipe through converter
if [ "$OUTPUT_FORMAT" = "json" ]; then
  bash "${SCRIPT_DIR}/scan.sh" text | python3 -c "
import json, sys

data = {}
for line in sys.stdin:
    line = line.strip()
    if not line or line.startswith('==='):
        continue
    parts = line.split(':')
    key = parts[0]
    if key == 'SKILL':
        # name may contain ':', size is always the last field
        data.setdefault('skills', []).append({'name': ':'.join(parts[1:-1]), 'size': int(parts[-1])})
    elif key == 'BROKEN_SYMLINK':
        data.setdefault('broken_symlinks', []).append({'name': parts[1], 'target': ':'.join(parts[2:])})
    elif key == 'LOCAL_SUMMARY':
        data['local_count'] = int(parts[1])
        data['local_total_bytes'] = int(parts[2])
    elif key == 'PLUGIN':
        p = {'name': parts[1], 'skill_count': int(parts[2])}
        if len(parts) > 3: p['status'] = parts[3]
        data.setdefault('plugins', []).append(p)
    elif key == 'PLUGIN_SKILL':
        data.setdefault('plugin_skills', []).append({'plugin': parts[1], 'name': ':'.join(parts[2:])})
    elif key == 'CLAUDE_MD':
        data['claude_md_bytes'] = int(parts[1])
    elif key == 'CLAUDE_MD_SECTION':
        # name may contain ':', size is always last
        data.setdefault('claude_md_sections', []).append({'name': ':'.join(parts[1:-1]), 'size': int(parts[-1])})
    elif key == 'MEMORY':
        # MEMORY:project:name:size — size is always last
        data.setdefault('memory_files', []).append({
            'project': ':'.join(parts[1:-2]),
            'name': parts[-2],
            'size': int(parts[-1])
        })
    elif key == 'MEMORY_SUMMARY':
        data['memory_count'] = int(parts[1])
        data['memory_total_bytes'] = int(parts[2])
    elif key == 'MCP':
        data['mcp_servers'] = int(parts[1])
    elif key == 'MCP_SERVER':
        data.setdefault('mcp_server_list', []).append(':'.join(parts[1:]))
    elif key == 'ISSUE':
        issue = {'type': parts[1]}
        if parts[1] in ('oversized_skill', 'oversized_memory', 'temp_cache', 'stale_project'):
            # detail is last field, name is everything between type and detail
            issue['name'] = ':'.join(parts[2:-1])
            issue['detail'] = parts[-1]
        elif len(parts) > 3:
            issue['name'] = parts[2]
            issue['detail'] = ':'.join(parts[3:])
        else:
            issue['name'] = ':'.join(parts[2:])
        data.setdefault('issues', []).append(issue)

print(json.dumps(data, indent=2))
"
  exit 0
fi

CLAUDE_DIR="${HOME}/.claude"
SKILLS_DIR="${CLAUDE_DIR}/skills"
PLUGINS_DIR="${CLAUDE_DIR}/plugins/cache"
PROJECTS_DIR="${CLAUDE_DIR}/projects"

# Cache `claude plugin list` output once (reused for status + issue detection)
PLUGIN_LIST_CACHE=""
if command -v claude >/dev/null 2>&1; then
  PLUGIN_LIST_CACHE=$(claude plugin list 2>/dev/null || true)
fi

echo "=== LOCAL SKILLS ==="
local_count=0
local_total_bytes=0
if [ -d "$SKILLS_DIR" ] && [ "$(ls -A "$SKILLS_DIR" 2>/dev/null)" ]; then
  # Top-level skills
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
  # Nested skills (e.g., @internal-sys/commit-guide/)
  for dir in "$SKILLS_DIR"/*/*/; do
    [ -d "$dir" ] || continue
    parent=$(basename "$(dirname "$dir")")
    name="${parent}/$(basename "$dir")"
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
# Parse disabled plugins from cached output
disabled_plugins=""
if [ -n "$PLUGIN_LIST_CACHE" ]; then
  disabled_plugins=$(echo "$PLUGIN_LIST_CACHE" | python3 -c "
import sys
lines = sys.stdin.read().split('\n')
current_name = None
for line in lines:
    line = line.strip()
    if line.startswith('\u276f'):
        full = line.split('\u276f')[1].strip()
        if '@' in full:
            current_name = full.split('@')[1]
        else:
            current_name = full
    elif 'disabled' in line.lower() and current_name:
        print(current_name)
        current_name = None
    elif 'enabled' in line.lower():
        current_name = None
" 2>/dev/null || true)
fi

if [ -d "$PLUGINS_DIR" ]; then
  for plugin_dir in "$PLUGINS_DIR"/*/; do
    [ -d "$plugin_dir" ] || continue
    pname=$(basename "$plugin_dir")
    # Skip temp directories
    [[ "$pname" == temp_local_* ]] && continue
    # Walk version subdirectories if they exist
    count=$(find "$plugin_dir" -path "*/skills/*/SKILL.md" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$count" -gt 0 ]; then
      # Check if this plugin is disabled
      status="enabled"
      echo "$disabled_plugins" | grep -qxF "$pname" 2>/dev/null && status="disabled"
      echo "PLUGIN:${pname}:${count}:${status}"
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
  # Section-level breakdown by top-level markdown headers
  python3 -c "
import sys

with open(sys.argv[1]) as f:
    lines = f.readlines()

sections = []
current_name = None
current_bytes = 0

for line in lines:
    if line.startswith('# '):
        if current_name is not None:
            sections.append((current_name, current_bytes))
        elif current_bytes > 0:
            sections.append(('(preamble)', current_bytes))
        current_name = line[2:].strip()[:60]
        current_bytes = len(line.encode('utf-8'))
    else:
        current_bytes += len(line.encode('utf-8'))

if current_name is not None:
    sections.append((current_name, current_bytes))

for name, size in sections:
    print(f'CLAUDE_MD_SECTION:{name}:{size}')
" "${CLAUDE_DIR}/CLAUDE.md" 2>/dev/null || true
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
if [ -f "${CLAUDE_DIR}/settings.json" ]; then
  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
servers = d.get('mcpServers', {})
print(f'MCP:{len(servers)}')
for name in sorted(servers.keys()):
    print(f'MCP_SERVER:{name}')
" "${CLAUDE_DIR}/settings.json" 2>/dev/null || echo "MCP:0"
else
  echo "MCP:0"
fi

echo ""
echo "=== ISSUES ==="

# Broken symlinks (scoped to SKILL.md, covers top-level and nested)
[ -d "$SKILLS_DIR" ] && find "$SKILLS_DIR" -name "SKILL.md" -type l ! -exec test -e {} \; -print 2>/dev/null | while read -r link; do
  dir=$(dirname "$link")
  relpath=$(python3 -c "import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))" "$dir" "$SKILLS_DIR" 2>/dev/null || basename "$dir")
  target=$(readlink "$link" 2>/dev/null || echo "unknown")
  echo "ISSUE:broken_symlink:${relpath}:${target}"
done

# Duplicate skills (local name exists in plugin) — top-level + nested
if [ -d "$SKILLS_DIR" ] && [ -d "$PLUGINS_DIR" ]; then
  plugin_skill_names=$(find "$PLUGINS_DIR" -path "*/skills/*/SKILL.md" -exec bash -c 'basename "$(dirname "$1")"' _ {} \; 2>/dev/null | sort -u)
  # Top-level
  for dir in "$SKILLS_DIR"/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    [ -f "${dir}SKILL.md" ] || continue
    echo "$plugin_skill_names" | grep -qxF "$name" 2>/dev/null && echo "ISSUE:duplicate:${name}:local+plugin"
  done
  # Nested
  for dir in "$SKILLS_DIR"/*/*/; do
    [ -d "$dir" ] || continue
    [ -f "${dir}SKILL.md" ] || continue
    name=$(basename "$dir")
    echo "$plugin_skill_names" | grep -qxF "$name" 2>/dev/null && echo "ISSUE:duplicate:$(basename "$(dirname "$dir")")/${name}:local+plugin"
  done
fi

# Empty/template skills — top-level + nested
if [ -d "$SKILLS_DIR" ]; then
  for dir in "$SKILLS_DIR"/*/; do
    [ -d "$dir" ] || continue
    if [ -f "${dir}SKILL.md" ] && grep -q "Replace with description" "${dir}SKILL.md" 2>/dev/null; then
      echo "ISSUE:template:$(basename "$dir")"
    fi
  done
  for dir in "$SKILLS_DIR"/*/*/; do
    [ -d "$dir" ] || continue
    if [ -f "${dir}SKILL.md" ] && grep -q "Replace with description" "${dir}SKILL.md" 2>/dev/null; then
      echo "ISSUE:template:$(basename "$(dirname "$dir")")/$(basename "$dir")"
    fi
  done
fi

# .skill duplicate directories
[ -d "$SKILLS_DIR" ] && for dir in "$SKILLS_DIR"/*.skill/; do
  [ -d "$dir" ] || continue
  base=$(basename "$dir" .skill)
  [ -d "${SKILLS_DIR}/${base}" ] && echo "ISSUE:skill_dup:${base}"
done

# Oversized skill files (>10KB) — top-level + nested
if [ -d "$SKILLS_DIR" ]; then
  for dir in "$SKILLS_DIR"/*/; do
    [ -d "$dir" ] || continue
    if [ -f "${dir}SKILL.md" ]; then
      name=$(basename "$dir")
      size=$(wc -c < "${dir}SKILL.md" | tr -d ' ')
      [ "$size" -gt 10240 ] && echo "ISSUE:oversized_skill:${name}:${size}"
    fi
  done
  for dir in "$SKILLS_DIR"/*/*/; do
    [ -d "$dir" ] || continue
    if [ -f "${dir}SKILL.md" ]; then
      name="$(basename "$(dirname "$dir")")/$(basename "$dir")"
      size=$(wc -c < "${dir}SKILL.md" | tr -d ' ')
      [ "$size" -gt 10240 ] && echo "ISSUE:oversized_skill:${name}:${size}"
    fi
  done
fi

# Oversized memory files (>5KB)
[ -d "$PROJECTS_DIR" ] && find "$PROJECTS_DIR" -path "*/memory/*.md" -type f -size +5k 2>/dev/null | while read -r f; do
  size=$(wc -c < "$f" | tr -d ' ')
  project=$(echo "$f" | sed "s|${PROJECTS_DIR}/||" | cut -d/ -f1)
  fname=$(basename "$f")
  echo "ISSUE:oversized_memory:${project}/${fname}:${size}"
done

# Stale project memory (no files modified in 90+ days)
if [ -d "$PROJECTS_DIR" ]; then
  for proj_dir in "$PROJECTS_DIR"/*/; do
    [ -d "${proj_dir}memory" ] || continue
    project=$(basename "$proj_dir")
    # Quick check: any file modified in last 90 days? (maxdepth 1 to match glob below)
    recent=$(find "${proj_dir}memory" -maxdepth 1 -type f -name "*.md" -mtime -90 2>/dev/null | wc -l | tr -d ' ')
    if [ "$recent" -eq 0 ]; then
      # All files older than 90 days — get details via python3
      detail=$(python3 -c "
import os, sys, glob, time
files = glob.glob(sys.argv[1] + '/*.md')
if files:
    newest = max(os.path.getmtime(f) for f in files)
    days = int((time.time() - newest) / 86400)
    total = sum(os.path.getsize(f) for f in files)
    print(f'{days}d,{len(files)}files,{total}bytes')
" "${proj_dir}memory" 2>/dev/null)
      [ -n "$detail" ] && echo "ISSUE:stale_project:${project}:${detail}"
    fi
  done
fi

# Temp/orphaned plugin cache (failed installs)
[ -d "$PLUGINS_DIR" ] && for dir in "$PLUGINS_DIR"/temp_local_*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  size=$(du -sk "$dir" 2>/dev/null | cut -f1)
  echo "ISSUE:temp_cache:${name}:${size}KB"
done

# Disabled plugins (still in cache) — uses cached plugin list
if [ -n "$PLUGIN_LIST_CACHE" ]; then
  echo "$PLUGIN_LIST_CACHE" | python3 -c "
import sys
lines = sys.stdin.read().split('\n')
current_name = None
for line in lines:
    line = line.strip()
    if line.startswith('\u276f'):
        current_name = line.split('\u276f')[1].strip()
    elif 'disabled' in line.lower() and current_name:
        print(f'ISSUE:disabled_plugin:{current_name}')
        current_name = None
    elif 'enabled' in line.lower():
        current_name = None
" 2>/dev/null || true
fi

echo ""
echo "=== DONE ==="
