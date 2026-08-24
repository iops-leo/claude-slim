---
name: claude-slim
description: "Analyze and reduce Claude Code token overhead. Scans skills, plugins, memory files, and CLAUDE.md for bloat — then cleans up with user approval. Use when: /claude-slim, token optimization, reduce tokens, slim down, cleanup skills, token diet, save tokens, context diet"
---

# claude-slim — Token Overhead Reducer

Analyze the user's Claude Code environment for token waste and perform non-destructive cleanup.

## Subcommands

- `/claude-slim` or `/claude-slim run` → full pipeline (scan → propose → execute → report)
- `/claude-slim scan` → report only, no changes
- `/claude-slim scan --json` → raw JSON output
- `/claude-slim doctor` → check scanner prerequisites and session-log signal quality
- `/claude-slim check-update` → report whether a newer version is published
- `/claude-slim restore` → restore previously disabled items

---

## Running the CLI

Every command block below opens with a `claude_slim()` resolver. It is repeated in full each
time on purpose: each Bash invocation is a fresh shell, so a function defined in one
block does not survive into the next. It resolves in three tiers — the plugin's own
`dist/cli.js` when `CLAUDE_PLUGIN_ROOT` is set, then a `claude-slim` on `PATH`, then
`npx`. That last tier is what makes the skill work when it was installed by
`npx skills add` rather than `claude plugin install`, where no plugin root exists.

Do not shorten the name. A two-letter `cs` collides with claude-squad's binary, and a
shell function is invisible to `timeout`, `env`, and `xargs` — a wrapped call would
silently run that other program instead. Call `claude_slim` directly, never through a
wrapper.

---

## Phase 0 — Version gate (run before every scan)

An outdated claude-slim does not merely lack features — it reports **wrong numbers**. Versions before 2.8.0 summed memory across every project on disk and inflated the startup estimate roughly 8×. Presenting those figures as fact is worse than not running at all, so check first:

```bash
claude_slim(){ if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/dist/cli.js" ]; then node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" "$@"; elif command -v claude-slim >/dev/null 2>&1; then claude-slim "$@"; else npx -y 'claude-slim@^2' "$@"; fi; }
claude_slim check-update --json
```

The check is cached for 24h and fails open — if it errors, times out, or returns `"latest": null`, **proceed silently**. Never block the user because a version lookup failed.

The response carries `installMethod`. When it is `"npx"` the gate is structurally
inert — the CLI was just fetched at the tag it is being compared against, so `outdated`
can never be true. Note that the version was resolved at run time and move on; do not
present the gate as a safeguard it is not.

If `"outdated": true`, stop and tell the user before scanning:

> 설치된 claude-slim이 {installed}이고 최신은 {latest}입니다.
> 2.8.0 이전 버전은 시작 토큰을 약 8배 부풀려 보고합니다 — 지금 스캔하면 그 숫자가 나옵니다.
>
> {upgradeCommand}
>
> 업데이트 후 진행할까요, 아니면 현재 버전으로 계속할까요?

Then honour their answer. If they choose to continue, run the scan but **label the numbers as coming from an outdated version** in your report.

**Plugin installs need a restart** (only when `installMethod` is `"plugin"`). `claude plugin update` writes the new version to disk, but the running session keeps the loaded copy. Tell the user this explicitly — otherwise they update, re-run, and see the same stale numbers with no idea why.

If `"outdated": false`, say nothing and continue to Phase 1.

---

## Phase 1 — Scan

Run the CLI to collect environment data:

```bash
claude_slim(){ if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/dist/cli.js" ]; then node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" "$@"; elif command -v claude-slim >/dev/null 2>&1; then claude-slim "$@"; else npx -y 'claude-slim@^2' "$@"; fi; }
claude_slim scan --json
```

If that command fails for **any** reason — `node` missing, or the `npx` tier unable to
reach the npm registry because the machine is offline or behind a proxy — fall back to
the legacy bash scanner. It needs neither node nor a network:

```bash
for d in "${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/claude-slim}" "$HOME/.claude/skills/claude-slim" "./.claude/skills/claude-slim"; do
  [ -n "$d" ] || continue
  if [ -f "$d/scripts/scan.sh" ]; then bash "$d/scripts/scan.sh" json; exit $?; fi
done
echo "claude-slim: no scan.sh found in any known skill directory" >&2
exit 1
```

If this fails too, tell the user the scan could not run and **stop**. Never continue to
Phase 2 without data: an empty scan is indistinguishable from a clean environment, and
reporting zeros as fact is the one outcome worse than reporting nothing.

---

## Phase 2 — Interpret & Present

After getting the scan JSON, YOU must interpret and present results to the user. Do NOT just dump raw CLI output. Present a full diagnostic report in the user's language.

> **Templates below are shown in English for readability. Always translate headers, labels, and prompts into the user's detected language when rendering.**

### 2-0. Two numbers that are not interchangeable

The JSON reports token counts in two different units, and mixing them produces
savings figures larger than the entire thing being saved:

- **`listingTokens`** (and `totalTokensBefore`, `recoverableStartupTokens`) —
  what a session pays at startup for the catalog line.
- **`tokens`** on a skill or an issue — the whole SKILL.md body, paid only when
  that skill is actually invoked.

`Issue.tokens` is the second kind. **Never sum it and call the result savings.**
On a real machine that sum was 215,535 against a 13,434-token startup total —
16× the whole budget. Use `recoverableStartupTokens`, which the CLI already
computes with duplicates collapsed and the right unit.

Quote body tokens only when explaining what one skill costs *per invocation*,
and label them that way.

### 2-1. Environment Snapshot Table

Show a summary table:

| Item | Count | Tokens |
|------|-------|--------|
| Local skills | N (XKB) | X tok |
| Plugins | N (M skills) | ~X tok |
| CLAUDE.md | XKB | X tok |
| Memory files | N (XKB) | ~X tok |
| **Session startup overhead** | | **~X tok** (`totalTokensBefore`) |

**Check `currentProjectKnown` before presenting memory numbers.** When it is
`false`, Claude Code holds no state for that slug. The `0` is correct, but it
may be answering the wrong question — the slug can point at a plugin cache or a
git worktree rather than the project the user meant. Say that no project state
backs this path and offer `--project-dir <path>`, instead of presenting the 0 as
a clean result. Do not assert the memory was lost: a directory Claude has never
opened really does have none.

### 2-2. Plugin Detail Table

List each plugin with skill count and a judgment:

| Plugin | Skills | Notes |
|--------|:------:|-------|
| omc | 36 | Core plugin. Keep. |
| temp_local_... | 1 | **Failed install remnant. Cleanup target.** |

Annotate each with status: actively used, possibly unused, or cleanup target. Flag `temp_local_*` entries as failed install remnants.

### 2-3. Issue Analysis by Tier

Group issues by tier and explain EACH one with context and recommendation:

**Tier 1 — Immediate cleanup (zero risk):**
These are safe to remove with zero risk: broken symlinks, empty templates, .skill/ duplicates, temp_local_* cache. Pre-selected. Explain why each is safe.

**Tier 2 — Recommended cleanup:**
These are recommended but need user judgment. For each issue, explain:
- What is it and why it's flagged
- What happens if you remove it (safe? any side effects?)
- How many tokens it saves

Example: "frontend-design exists both locally and in a plugin. Removing the local copy is safe because the plugin version remains. Saves ~823 tok."

**Tier 3 — Optional (user judgment):**
These are large skills that cost tokens but might be in active use. For each:
- Show size and token cost
- Judge whether the user likely uses it (based on what it does)
- Recommend: keep if active, disable if rarely used

### 2-4. Recommended Actions

End with a numbered action list, ordered by impact:
1. What to do first (highest token savings, lowest risk)
2. What to consider
3. What to leave alone and why

For total savings, quote **`recoverableStartupTokens`** and state it against
`totalTokensBefore` ("~2,700 of ~13,400 startup tokens"). Do not add up the
per-issue numbers — see 2-0. A skill flagged three times is one cleanup, and
its body size is not a startup cost.

If subcommand is `scan`, stop here. Ask a localized equivalent of "Proceed with cleanup?" only for the full pipeline.

---

## Phase 3 — Clean (full pipeline only)

Run the interactive clean command:

```bash
claude_slim(){ if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/dist/cli.js" ]; then node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" "$@"; elif command -v claude-slim >/dev/null 2>&1; then claude-slim "$@"; else npx -y 'claude-slim@^2' "$@"; fi; }
claude_slim clean
```

Or with dry-run:
```bash
claude_slim(){ if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/dist/cli.js" ]; then node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" "$@"; elif command -v claude-slim >/dev/null 2>&1; then claude-slim "$@"; else npx -y 'claude-slim@^2' "$@"; fi; }
claude_slim clean --dry-run
```

After cleanup, re-run scan to get updated numbers, then show the savings report:

```bash
claude_slim(){ if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/dist/cli.js" ]; then node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" "$@"; elif command -v claude-slim >/dev/null 2>&1; then claude-slim "$@"; else npx -y 'claude-slim@^2' "$@"; fi; }
claude_slim report
```

Present the report box AND the before/after breakdown table to the user.

---

## Phase 4 — Restore

When `/claude-slim restore` is invoked:

```bash
claude_slim(){ if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/dist/cli.js" ]; then node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" "$@"; elif command -v claude-slim >/dev/null 2>&1; then claude-slim "$@"; else npx -y 'claude-slim@^2' "$@"; fi; }
claude_slim restore
```

## Doctor

When `/claude-slim doctor` is invoked:

```bash
claude_slim(){ if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/dist/cli.js" ]; then node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" "$@"; elif command -v claude-slim >/dev/null 2>&1; then claude-slim "$@"; else npx -y 'claude-slim@^2' "$@"; fi; }
claude_slim doctor
```

Explain warnings in the user's language. Pay special attention to session-log warnings because they explain why unused-skill detection may be suppressed.

---

## Language

Detect the user's language from their most recent message. Present all reports, analysis, and explanations in that language — including table headers, tier labels, prompts, and every user-facing string. The CLI output is machine-readable (always English) and must not be echoed verbatim; translate its content into the user's language when you interpret it. The example tables above are written in English only for authoring clarity — do not treat them as a required output format.

## Rules

1. **Never delete user data.** Skill directories and project memory are moved to `~/.claude/skills.disabled/`; dead symlink files and failed-install `temp_local_*` caches are permanent cleanups and should be described that way.
2. **Never modify CLAUDE.md or settings.json.**
3. **Never disable plugin-managed skills.** Report only.
4. **Always confirm before executing.** Use `--dry-run` to preview changes.
5. **If nothing to clean:** respond "Already slim!" and exit.
6. **Always interpret results.** Never dump raw CLI output without analysis. You are the diagnostic layer — the CLI is the data layer.
