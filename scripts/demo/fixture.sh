#!/usr/bin/env bash
# Build a synthetic ~/.claude/ at $DEMO_HOME/.claude that triggers the four
# hero detectors used in the README demo (broken-symlink, duplicate, oversized,
# unused) and produces ~12K tokens of session-startup overhead, matching the
# README's "before/after" claim.
#
# Token math (claude-slim's overhead = skill_count × 30 + CLAUDE.md + memory):
#   ~25 local + 2 plugin skills × 30 = ~810  listing tokens
#   CLAUDE.md                          ~4,000 tokens
#   3 stale + 1 active project memory  ~7,000 tokens
#   ────────────────────────────────────────────────
#   Total before                       ~11,800 tokens
#
# Used by scripts/demo/demo.tape (vhs) — run with `Env HOME $DEMO_HOME`.
# Idempotent: wipes and rebuilds on every run. Only touches paths under /tmp.

set -euo pipefail

DEMO_HOME="${DEMO_HOME:-/tmp/claude-slim-demo}"
CLAUDE="$DEMO_HOME/.claude"

case "$DEMO_HOME" in
  /tmp/*|/var/folders/*) ;;
  *) echo "fixture: DEMO_HOME must live under /tmp; got: $DEMO_HOME" >&2; exit 1 ;;
esac

rm -rf "$DEMO_HOME"
mkdir -p "$CLAUDE/skills" "$CLAUDE/plugins/cache" "$CLAUDE/projects"

# ----- HELPERS --------------------------------------------------------------

write_skill() {
  local name="$1" desc="$2" body="$3"
  mkdir -p "$CLAUDE/skills/$name"
  cat > "$CLAUDE/skills/$name/SKILL.md" <<EOF
---
name: $name
description: $desc
---
$body
EOF
}

# ----- HERO LOCAL SKILLS (each triggers one detector or stays healthy) ------

# 1. autopilot — healthy, INVOKED in session log (no flag)
write_skill autopilot \
  "Full autonomous execution from idea to working code. Plans, implements, tests, and verifies a feature end-to-end without intermediate prompts." \
  "Workflow: explore → plan → execute → verify → ship. Each phase produces evidence the next consumes. Failures roll back to the last verified state."

# 2. ralph — UNUSED (never appears in session-log Skill invocations)
write_skill ralph \
  "Self-referential loop until task completion with architect verification. Keeps re-running the executor until verifier passes or max-loops hits." \
  "The boulder never stops. ralph keeps the executor in a tight feedback loop with verifier, calling architect on disagreements."

# 3. brainstorming — DUPLICATE (also lives under plugins/cache/superpowers/)
write_skill brainstorming \
  "Use before any creative work — creating features, building components, adding functionality, or modifying behavior. Explores intent before implementation." \
  "Surfaces requirements through questions, not assertions. Walks the user through the design tree before any code is written."

# 4. figma-use — OVERSIZED (>10KB SKILL.md, INVOKED so it's only flagged oversized)
mkdir -p "$CLAUDE/skills/figma-use"
{
  cat <<'HEAD'
---
name: figma-use
description: MANDATORY prerequisite — invoke before every use_figma tool call. Teaches Figma Plugin API patterns, write transactions, variable bindings, auto-layout edits, and component variant authoring.
---
HEAD
  for _ in $(seq 1 28); do
    cat <<'PARA'

## Plugin API surface

The use_figma tool runs JavaScript inside the Figma file context. Every write
must be wrapped in a transaction. Read operations may be batched but writes
must not span multiple transactions or the editor history will desync.

Common pitfalls: setting fills directly on a node bound to a variable, mixing
auto-layout layoutMode changes with sibling reorders in one pass, and
forgetting to await loadFontAsync before mutating text. Each pattern below
shows the canonical recipe and the failure mode it avoids.
PARA
  done
} > "$CLAUDE/skills/figma-use/SKILL.md"

# 5. kakao-internal — BROKEN SYMLINK (target removed when plugin was uninstalled)
mkdir -p "$CLAUDE/skills/kakao-internal"
ln -sf "/nonexistent/uninstalled-pack/skills/kakao-internal/SKILL.md" \
       "$CLAUDE/skills/kakao-internal/SKILL.md"

# ----- FILLER SKILLS (realistic OMC-flavored names; mostly UNUSED) ----------
# These bulk up the skill listing tokens to a realistic ~30-skill power-user
# environment. ~7 are invoked in session logs (active), the rest are unused —
# the demo lists "+N more unused skills" rather than naming each one.

ACTIVE_SKILLS=(plan debugger executor verifier designer writer)
for s in "${ACTIVE_SKILLS[@]}"; do
  write_skill "$s" \
    "OMC ${s}-lane skill. Delegated work for ${s}-shaped tasks." \
    "Standard ${s} workflow: receive context, produce ${s}-quality output, hand back evidence. See CONTRIBUTING for the agent catalog."
done

UNUSED_SKILLS=(analyst architect code-reviewer security-reviewer quality-reviewer
               test-engineer build-fixer deep-executor scientist qa-tester
               document-specialist critic explore learner)
for s in "${UNUSED_SKILLS[@]}"; do
  write_skill "$s" \
    "OMC ${s} agent skill. Specialized prompt for ${s}-shaped delegations." \
    "${s} expects a structured handoff. Returns evidence the caller can verify."
done

# ----- PLUGIN SKILLS --------------------------------------------------------

mkdir -p "$CLAUDE/plugins/cache/superpowers/skills/brainstorming"
cat > "$CLAUDE/plugins/cache/superpowers/skills/brainstorming/SKILL.md" <<'EOF'
---
name: brainstorming
description: (plugin copy) Same brainstorming skill, registered via the superpowers marketplace plugin. Causes a local+plugin duplicate.
---
This is the plugin-side copy. The local-side at ~/.claude/skills/brainstorming
duplicates it; claude-slim's duplicate detector flags both.
EOF

mkdir -p "$CLAUDE/plugins/cache/superpowers/skills/tdd"
cat > "$CLAUDE/plugins/cache/superpowers/skills/tdd/SKILL.md" <<'EOF'
---
name: tdd
description: Test-Driven Development enforcement skill. Red, green, refactor — fail first, then make it pass.
---
Write the smallest failing test that captures the requirement. Watch it fail.
Write the smallest implementation that makes it pass. Refactor with tests green.
EOF

# ----- CLAUDE.md (~4,000 tokens; OMC-style behavioral rules) ----------------

{
  cat <<'TOP'
# Behavioral Defaults

- State assumptions before coding. Surface ambiguity, don't pick silently.
- Push back when a simpler path exists.
- Goal-driven execution. Convert vague tasks into verifiable checks.
- Autonomous-mode exception: prefer documented assumption over halting.

# oh-my-claudecode — Multi-Agent Orchestration

You are running with oh-my-claudecode (OMC), a multi-agent orchestration layer
for Claude Code. Coordinate specialized agents, tools, and skills.
TOP
  for _ in $(seq 1 22); do
    cat <<'BLK'

<delegation_rules>
Use delegation when it improves quality, speed, or correctness:
- Multi-file implementations, refactors, debugging, reviews, planning, research.
- Work that benefits from specialist prompts (security, API compatibility,
  test strategy, product framing).
- Independent tasks that can run in parallel.

Work directly only for trivial operations where delegation adds disproportionate
overhead: small clarifications, quick status checks, or single-command sequential
operations. For substantive code changes, route implementation to executor.
</delegation_rules>

<model_routing>
Pass model on Task calls to match complexity. haiku for quick lookups,
lightweight scans, narrow checks. sonnet for standard implementation,
debugging, reviews. opus for architecture, deep analysis, complex refactors.
</model_routing>

<verification>
Verify before claiming completion. Evidence-backed confidence, not ceremony.
Sizing guidance: small changes use haiku verifier. Standard changes use sonnet.
Large or security/architectural changes use opus. Verification loop: identify
what proves the claim, run the verification, read the output, then report with
evidence. If verification fails, continue iterating rather than reporting
incomplete work.
</verification>
BLK
  done
} > "$CLAUDE/CLAUDE.md"

# ----- MEMORY: 1 active project + 3 stale projects --------------------------

write_memory() {
  local project="$1" filename="$2" content="$3"
  mkdir -p "$CLAUDE/projects/$project/memory"
  cat > "$CLAUDE/projects/$project/memory/$filename" <<EOF
---
name: $(basename "$filename" .md)
type: project
---
$content
EOF
}

# Active project (recent mtime, NOT stale)
write_memory "-Users-demo-Project-app" "MEMORY.md" \
  "$(printf -- '- [stack notes](stack.md) — Postgres + Node 20 + Vitest. Dev DB seeded via pnpm db:reset.\n- [auth model](auth.md) — JWT with 15m access + 30d refresh, rotated on every refresh call.\n')"

# Generate ~1,500 tokens of project memory across stale projects.
gen_long_memory() {
  for _ in $(seq 1 18); do
    cat <<'M'
The service runs on a managed Postgres 16 cluster with three read replicas. We
intentionally avoid an ORM — raw SQL with prepared statements via the official
node-postgres driver. Migrations are forward-only; rollbacks happen by writing
a new forward migration that reverses the change. CI runs both unit and
integration tests; integration tests use a real isolated schema per worker
because mocked tests masked a broken migration in 2025-Q4.
M
  done
}

LONG_MEM="$(gen_long_memory)"

write_memory "-Users-demo-Project-old-spike" "MEMORY.md" "$LONG_MEM"
write_memory "-Users-demo-Project-deprecated-svc" "MEMORY.md" "$LONG_MEM"
write_memory "-Users-demo-Project-prototype-q1" "MEMORY.md" "$LONG_MEM"

# Backdate the three stale projects' file mtimes by 120 days. The detector
# scans memory.ts via the project dir's most-recent mtime within.
STALE_TS_TOUCH="$(date -v-120d +%Y%m%d%H%M 2>/dev/null || date -d '120 days ago' +%Y%m%d%H%M)"
for p in old-spike deprecated-svc prototype-q1; do
  find "$CLAUDE/projects/-Users-demo-Project-$p" -exec touch -t "$STALE_TS_TOUCH" {} +
done

# ----- SESSION LOGS (3+ sessions, with Skill invocations) ------------------
# scanner/sessions.ts requires ≥3 sessions in lookback window AND ≥1 Skill
# invocation. Crucially, "ralph" and the UNUSED_SKILLS list must NOT appear.

write_session() {
  local session_file="$1"; shift
  : > "$session_file"
  for skill in "$@"; do
    printf '%s\n' "{\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Skill\",\"input\":{\"skill\":\"$skill\"}}]}}" >> "$session_file"
  done
}

ACTIVE_PROJECT="$CLAUDE/projects/-Users-demo-Project-app"
write_session "$ACTIVE_PROJECT/abc123.jsonl" autopilot brainstorming plan
write_session "$ACTIVE_PROJECT/def456.jsonl" tdd autopilot debugger executor
write_session "$ACTIVE_PROJECT/ghi789.jsonl" brainstorming figma-use verifier designer writer

# ----- SUMMARY -------------------------------------------------------------

LOCAL_COUNT=$(find "$CLAUDE/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
PLUGIN_COUNT=$(find "$CLAUDE/plugins/cache" -name SKILL.md | wc -l | tr -d ' ')
CLAUDE_BYTES=$(wc -c < "$CLAUDE/CLAUDE.md" | tr -d ' ')
PROJECT_COUNT=$(find "$CLAUDE/projects" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')

cat <<EOF
fixture: built at $CLAUDE
  local skills:    $LOCAL_COUNT (incl. 1 broken symlink, 1 duplicate, 1 oversized, $((LOCAL_COUNT - 4 - 6)) unused, 7 healthy)
  plugin skills:   $PLUGIN_COUNT
  CLAUDE.md:       $CLAUDE_BYTES bytes
  projects:        $PROJECT_COUNT (1 active, 3 stale @ 120d)
  sessions:        3 (in 60d window, with 12 distinct Skill invocations)

Run claude-slim against this fixture:
  HOME=$DEMO_HOME npx claude-slim scan
EOF
