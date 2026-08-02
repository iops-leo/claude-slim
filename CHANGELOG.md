# Changelog

All notable changes to claude-slim are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.10.0] — 2026-08-02

Codex support, scoped to what Codex can actually be asked.

### Added
- **`~/.codex/` is scanned when present.** `scan` auto-detects a Codex install and appends a section reporting its startup cost: local skills, plugin skills, agents, and `AGENTS.md`. `scan --json` gains a `codex` key (`null` when Codex is absent). `--no-codex` skips it. On the development machine this surfaced **10,926 tokens** of Codex startup context that nothing was measuring — including a `humanize-korean.bak.20260711-100101` backup copy still costing 285 tokens per session.
- Codex's `SKILL.md` frontmatter is byte-identical in shape to Claude Code's, so the v2.8.0 listing parser is reused unchanged across all 36 local and 55 plugin skills. Agents differ — `<name>.toml` with `description = "…"` — and get a small dedicated parser, verified against all 18 installed agents.

- **Backup-artifact detection, on both agents.** A name like `humanize-korean.bak.20260711-100101` announces itself as a leftover copy without needing any usage signal, which makes it the one cleanup hint that also works on Codex. Claude Code raises it as a Tier 2 (Recommended) issue, movable and restorable like any other skill; Codex reports it under `LIKELY BACKUP COPIES` and leaves it alone. Matching is restricted to artifact *shapes* — dotted segments (`.bak`, `.orig`, `.old`), timestamp and dated suffixes, trailing `copy`, `~`, `(1)` — never a bare substring, so `backup-manager`, `test-engineer`, and `old-school-linter` are not touched. 25 such names are pinned in tests.

### Notes
- **Unused-skill detection is deliberately not offered for Codex,** and `scan` says so rather than staying quiet. Codex session logs record the skill *catalog* injected into each system prompt, not invocations: every skill appears in nearly every session, so treating them as a usage signal would mark everything "used". This was checked against 408 session files, a 56,724-row log database, and the `thread_dynamic_tools` table (a tool registry, not a history) before concluding. The same principle already governs the Claude path, which suppresses the check when session data is too thin to support it.
- **`~/.codex/` is read-only.** Nothing there is moved or deleted, matching how `~/.claude/agents/` is handled — measurement without a restore path, not cleanup without an undo.
- The Claude Code scanner is untouched. Codex lives in `src/codex/` and reuses only the tokenizer and frontmatter parser, so the 279 existing tests keep guarding the same code they always did.

### Internal
- Tests: 279 → 347 (+68). Two caught real defects during development: the TOML parser matched a `description = "…"` line sitting inside a `developer_instructions = """…"""` prose block, and `--no-codex` was inert because commander maps a negated flag to `opts.codex === false`, not `opts.noCodex`. The backup detector's false-positive suite is deliberately larger than its positive one: telling someone a working skill is disposable is worse than missing a stale copy.

## [2.9.1] — 2026-07-30

Found while stress-testing the scanner against deliberately hostile `~/.claude` fixtures before submitting the project for public feedback.

### Fixed
- **`scan` could hang indefinitely on a single long line.** js-tiktoken's BPE is quadratic in the length of one whitespace-free run. Ordinary prose is unaffected — the pre-tokenizer splits on whitespace, so 8,000 characters of normal text encodes in ~1ms — but an unbroken run is not. Measured on cl100k_base: 800 characters of Hangul cost ~450ms, 3,200 cost ~6.8s, and a 60,000-character run wedged `scan` past 20 seconds with **no output and no error**, which reads as a freeze rather than a failure. Real `SKILL.md` files reach this through base64 blobs, minified snippets, embedded JSON schemas, and CJK text; an installed skill on the development machine already carried a 530-character schema line. `countTokens` now encodes only a bounded prefix of any run over 512 characters and scales the result. A fixed characters-per-token divisor was tried first and rejected: measured density ranges from 0.8 chars/token for Hangul to 8.0 for repeated ASCII, so it was off by up to 100%, whereas sampling the run's own prefix stays within 2% for every type tested. **Files without a long run take a fast path and produce byte-identical counts** — verified across all 71 installed skills, where 70 matched exactly and the one containing a long run moved by 0.01%. Hostile fixture: 20s+ hang → 1.78s. No measurable change on ordinary input (1.68s → 1.76s, within noise).
- **A mistyped subcommand reported the wrong problem.** `claude-slim scam` printed commander's internal `error: too many arguments. Expected 0 arguments but got 1`, because the bare program carries an action and the stray token was routed to it. It now names the unknown command and lists the real ones.

### Internal
- Tests: 266 → 279 (+13), asserting both halves of the tokenizer fix — bounded time on pathological input, and exact agreement with the encoder on well-formed text including at the 512-character boundary. Two of the new tests failed on first write and corrected the implementation: the fixed-divisor estimate was off by ~100% on repeated ASCII, and the accuracy test itself timed out because verifying the fix requires calling the slow unbounded encoder it exists to avoid.

## [2.9.0] — 2026-07-25

Version-drift detection. Prompted by finding a real install running **2.0.0 while 2.8.1 was published** — eight releases behind, with nothing anywhere in the tool or the plugin system telling the user. Since versions before 2.8.0 inflate the startup estimate ~8×, a stale install does not merely lack features: it reports numbers that are wrong.

### Added
- **`claude-slim check-update`** — reports whether a newer version is published, and prints the upgrade command matching how this copy was actually installed (Claude Code plugin, global npm, npx, or source checkout). `--json` for machine output, `--force` to bypass the cache.
- **Version check in `doctor`** — the same comparison as a normal check row. `doctor --offline` skips it entirely.
- **Version gate in the skill (`SKILL.md` Phase 0)** — `/claude-slim` now checks before scanning and, if the install is outdated, tells the user what they are about to get and asks whether to update first or proceed. It also states that plugin updates need a session restart to take effect, which is otherwise an easy way to update, re-run, and see identical stale numbers with no explanation.

### Changed
- **`SECURITY.md` no longer claims zero network access.** That guarantee was accurate until this release and is now stated precisely: `scan`, `clean`, `restore`, and `report` still make no outbound requests; the version check in `doctor` / `check-update` is the sole exception. It sends nothing about the user, times out in 2.5s, fails open, caches for 24h, and is skippable with `--offline`.

### Notes
- **claude-slim does not update itself.** Updating is the package manager's job (`claude plugin update`, `npm install -g`); writing into a directory the plugin manager owns is a reliable way to corrupt an install. This release detects and advises, nothing more.
- The plugin upgrade hint uses the qualified `claude-slim@claude-slim` id — the bare name fails with `Plugin "claude-slim" not found` when a marketplace shares the plugin's name, which is exactly the case here.
- Tests: 241 → 266 (+25), covering numeric version ordering (`2.10.0 > 2.9.0`), install-method detection, cache hit/expiry/force, atomic cache writes, and fail-open behaviour on both a `null` return and a throwing fetcher.

## [2.8.1] — 2026-07-25

### Fixed
- **`initTokenizer()` rebuilt the cl100k_base encoder on every call.** Building it parses a large rank table — hundreds of milliseconds, and considerably more under CPU contention. The encoder is immutable once built, so it is now memoized; only the token cache is still reset per init. No user-visible behaviour change (the CLI initialises once per process), but the test suite calls it per-test and was intermittently blowing the 5s timeout. Reproduced under synthetic load: **45.6s with 1 failure → 16.6s with 0**.

### Docs
- README brought in line with v2.8.0 and the `ko` / `ja` / `zh` translations synced up from v2.7.1. The overhead table now carries measured values instead of estimates (skill listings ~10,100 tokens, agent catalog ~2,250, memory 0–63,500 depending on project), and a new section states plainly which figures are measured and which are still `~` estimates.
- `~/.claude/agents/` and `~/.claude/commands/` added to the "never touches" list and the directory tree, with the reason they are read-only.
- npm downloads and Node version badges added.

## [2.8.0] — 2026-07-25

Accuracy release. Three of the numbers claude-slim reported were wrong, and the
largest one was wrong by an order of magnitude. If your startup estimate drops
sharply after upgrading, the old number was the inaccurate one.

### Changed
- **The startup estimate no longer sums memory across every project on disk.** Claude Code loads `~/.claude/projects/<slug>/memory/` for the project a session is running in — not the other 40 project directories in your `~/.claude`. `totalTokensBefore` summed all of them, so the headline "tokens at session start" scaled with how many projects you had ever opened. On the development machine this reported **116,259 tokens where the real per-session cost was 14,399**. The estimate is now scoped to the current project (derived from `cwd`, matching Claude Code's slug format); the cross-project total is still shown in the MEMORY section, labelled as not being a per-session cost. `ScanResult` gains `currentProjectSlug`, `currentProjectMemoryTokens`, and `allProjectsMemoryTokens`.
- **Skill listing cost is measured, not assumed.** Every skill contributes a `- <name>: <description>` line to the system prompt, and the flat `SKILL_PROMPT_OVERHEAD_TOKENS = 30` estimate stood in for all of them. Measured across 68 installed skills the real spread is **30 → 509 tokens, mean 51** — a 70% under-count in aggregate, and the per-plugin cost gradient (v2.7.0) could not tell a plugin with five terse skills from one with five verbose ones. `SkillInfo` gains `listingTokens`, parsed from the frontmatter `description`. The flat constant remains as the fallback for a skill whose frontmatter is missing or unparseable, so malformed files degrade to pre-2.8 behaviour instead of reporting zero.

### Added
- **`~/.claude/agents/` and `~/.claude/commands/` are now scanned.** Plugin-supplied agents and commands were already counted; the user-level directories were invisible to every scanner despite being rendered into each session's system prompt (agents as the agent catalog, commands as the slash-command listing). On the development machine that was 12 agents worth ~2,254 tokens, absent from the total. Reported in a new `AGENTS & COMMANDS` section and included in `totalTokensBefore`. **Read-only:** they are measured and reported but never moved or deleted — there is no restore path for `~/.claude/agents/` yet, and shipping a destructive action without its undo would break the tool's central promise.
- **`npm run check:versions`** — fails when `.claude-plugin/plugin.json` or `.claude-plugin/marketplace.json` drifts from `package.json`. Wired into CI and `prepublishOnly`.

### Fixed
- **Plugin manifests were stuck at 2.7.0 for three releases.** `package.json` shipped 2.7.1, 2.7.2, and 2.7.3 while `.claude-plugin/plugin.json` and `marketplace.json` still advertised 2.7.0. `claude plugin install` reads the plugin manifests, not `package.json`, so plugin users saw a stale version throughout. All three are now bumped together and the new CI check makes the drift unrepeatable.
- **The token cache grew without bound.** `.token-cache.json` kept an entry for every file it had ever hashed, including skills long since uninstalled and session logs long since rotated. On the development machine **355 of 776 entries (46%, 139KB) pointed at files that no longer existed**. `flushCache()` now drops entries whose source file is gone — an entry for a missing path can never produce a hit again, so existence is a pruning predicate that cannot evict a live entry. The session-usage cache already pruned this way; the token cache did not.

### Internal
- `commander` 13 → 14, `vitest` 4.1.4 → 4.1.10, `@types/node` patch. TypeScript stays on 5.9: the 7.0 upgrade needs `@types/node` 26 and `tsconfig` changes, and belongs in its own PR.
- Tests: 206 → 241 (+35), covering frontmatter parsing (including the CRLF, block-scalar, and wrapped-value cases that broke the first implementation), cache pruning, user-surface scanning, and memory scoping.

## [2.7.3] — 2026-07-24

### Docs
- **README slimmed.** Replaced the v2.7.1 → v2.0 "What's new" stack (7 sections, ~66 lines duplicating CHANGELOG) with a single v2.7.2 section + a `[CHANGELOG.md](CHANGELOG.md)` link. README: 291 → 236 lines. Docs-only republish to refresh the npm package landing page — no functional, runtime, or test changes vs. v2.7.2.

## [2.7.2] — 2026-07-24

### Fixed
- **`unused_plugin` cleanup surfaced a raw `spawn claude ENOENT` when the `claude` CLI wasn't on PATH.** Users running `claude-slim` via `npx` outside a Claude Code install saw a scary Node error mid-cleanup, with one row per selected plugin. `cleanIssues` now probes the CLI once up front (via `isClaudeCliAvailable`), skips every `unused_plugin` item as `skipped` (not `errored`), and the CLI prints a single grouped `⚠ \`claude\` CLI not found on PATH — skipped N plugin(s)` notice pointing at the manual `claude plugin disable <name>` workaround. A defensive `ClaudeCliMissingError` catches the same case if `claude` was removed between the pre-check and the actual call (race window).
- **Nested-skill scanner missed `SKILL.md` files at depth 3+.** The prior two-level unroll walked `skills/<a>/SKILL.md` and `skills/<a>/<b>/SKILL.md` only. Plugin-namespaced layouts like `skills/<org>/<group>/<skill>/SKILL.md` were silently invisible — token totals under-reported and `unused_skill` could never flag them. Replaced with a bounded recursive walk (`MAX_SKILL_DEPTH = 3`) that stops descending once a `SKILL.md` is found (so nested docs under a declared skill don't become phantom duplicates).

### Changed
- **Invariant enforced: scanner code path must not touch stdout.** `claude-slim scan --json` pipes to `jq`; a stray `console.log` anywhere under `scanner/**` or `tokenizer.ts` would silently corrupt the machine-readable output. Added `scan-stdout-invariant.test.ts` that spies on `console.log` / `console.info` during the full scan pipeline and fails if either fires. Route diagnostics through `console.error`. No stray writes exist today — this is preventive.

### Added
- `isClaudeCliAvailable()` and `ClaudeCliMissingError` in `src/plugin-runtime.ts` — best-effort `claude --version` probe with 5s timeout, and a sentinel error class the cleaner uses to distinguish "missing binary" from "real cleanup failure."
- `CleanResult.claudeCliMissing?: boolean` — set when the pre-check or race-window catch fires, so the CLI can render one grouped message.

### Tests
- 190 → 206 (+16). New coverage: `scanLocalSkills` depth 1/2/3/4-boundary walk (`local-skills.test.ts`, 6 tests), `ClaudeCliMissingError` translation + `isClaudeCliAvailable` (`plugin-runtime.test.ts`, +6), pre-check skip semantics + no-probe-when-unneeded (`cleaner-plugin.test.ts`, +2), scan-pipeline stdout silence invariant with both minimal and rich fixtures — session logs, plugin cache, memory, CLAUDE.md (`scan-stdout-invariant.test.ts`, +2).

## [2.7.1] — 2026-07-20

### Fixed
- **`unused_plugin` savings estimate was always 0.** The detector emitted `tokens: 0` for every flagged plugin, so the dry-run summary and final report box under-counted savings for what is typically the largest cleanup target (`oh-my-claudecode` ~6,210 tok, etc.). The scanner now threads a per-plugin cost map into `DetectorContext` and the detector reads its own value from it. Regression tests added.
- **`duplicate` detector could disable namespaced local skills.** A `baseName` fallback flagged a local `org/ship` as a duplicate of a bare plugin `ship`, even though namespaced local skills are addressable independently and are not real duplicates. Cleanup would then move the local skill into `skills.disabled/`. The fallback is removed — only exact-name matches are flagged.
- **`stale_project` restore was scoped to all of `~/.claude/`.** A tampered manifest could name any legal `~/.claude/**` path as the restore target, redirecting a project-memory backup into `~/.claude/skills/` (or another subtree) and clobbering an unrelated asset. Restores are now type-scoped: `stale_project` targets must live under `~/.claude/projects/`, skill restores under `~/.claude/skills/`.
- **`claude-slim clean` in a non-TTY without `--auto`/`--dry-run` silently mutated the filesystem.** Prior behavior auto-selected Tier 1, surprising users running the CLI from scripts/nohup expecting a no-op. The CLI now prints a `⚠ Non-interactive shell detected` hint and exits with status 1; users must opt in with `--auto` (apply Tier 1) or `--dry-run` (preview).
- **`claude-slim report` said "No previous cleanup found" after zero-token cleanups.** Filtering on `tokenCount > 0` hid manifest entries whose only removals were `broken_symlink` or `temp_cache` (both zero-token). The report now surfaces every prior manifest entry.
- **`--lookback-days 0` and `--sessions-per-day 0` were silently upgraded.** `parseInt(x, 10) || N` collapsed an explicit 0 into the default. Replaced with a `parseNonNegativeInt(raw, fallback)` helper that only substitutes on non-string / non-finite / negative input.

### Changed
- `extractCommandsFromTranscript` uses `String.matchAll(pattern)` in place of a manual `lastIndex`-resetting `RegExp.exec` loop. The prior form relied on an explicit reset that would silently break if a future refactor added an early return inside the inner loop.

### Tests
- 188 → 190 (+2). New coverage: `unused_plugin` token propagation from the cost map, defaulting to 0 when a plugin is missing from the map.



### Added
- **`unused_plugin` detector — flags plugins whose skills, MCP tools, and commands were never invoked in the last 60 days of sessions.** Reads the same JSONL session transcripts used by `unused_skill`, now also extracting MCP tool prefixes (`mcp__plugin_<plugin>_<server>__*`) and slash commands. Issues are Tier 3 (Optional, never auto-selected) — the call is yours. Cleanup runs `claude plugin disable <name>` automatically; restore re-enables with `claude plugin enable <name>`.
- **PLUGIN BREAKDOWN table** — new section in the scan report showing every installed plugin, its token cost (CLAUDE.md section + skill registrations + MCP deferred tools + commands), usage status (used / unused / agent-only / insufficient data / disabled), and a per-plugin token estimate. Top offenders in a real env: `oh-my-claudecode` ~6,210 tok, `pm-skills` series ~2,500 tok combined.
- **`src/scanner/plugin-surfaces.ts`** — walks `~/.claude/plugins/cache/` and enumerates all user-callable surfaces per plugin (skills, MCP tool namespaces, slash commands, agents, hooks).
- **`src/scanner/plugin-cost.ts`** — per-plugin token estimation with calibrated constants: `DEFERRED_TOOL_OVERHEAD_TOKENS=8`, `COMMAND_OVERHEAD_TOKENS=10`, `MCP_SERVER_TOOLS_AVG=10` (validated against owner's real system prompt, ~1,500 tok for 209 MCP tools).
- **`src/scanner/plugin-breakdown.ts`** — combines surfaces + costs + session signals into `PluginBreakdown[]` rows; exports `formatPluginsTable()` renderer.
- **`src/plugin-runtime.ts`** — `disablePlugin(name)` / `enablePlugin(name)` via `execFile` (no shell). 30s timeout. Plugin name gated by regex validation (`^[a-zA-Z0-9_-]+$`).
- **`getInstalledPlugins()` (`src/scanner/disabled-plugins.ts`)** — enumerates installed plugins by marketplace identity (distinct from the existing `getDisabledPlugins()` which returns marketplace-level disabled status).
- **`recordDisabledPlugin`, `findDisabledPlugin`, `removeDisabledPlugin`** helpers in `src/manifest.ts` — track disabled plugin entries alongside existing skill/project entries.

### Changed
- **`scanSessionUsage()` now returns richer signals**: `mcpPrefixesInvoked: Set<string>`, `commandsInvoked: Set<string>`, `totalUserCallableInvocations: number`, `sessionsInWindow: number`. Existing fields (`invokedSkills`, `dataAvailable`) are unchanged — fully backward compatible.
- **Session JSONL parser bug fix**: user message content was only handled when it was an array; string-content messages (direct slash commands) were silently skipped, causing all slash-command invocations to be missed. Both shapes are now handled.
- **`DetectorContext` extended** with `pluginSurfaces`, `enabledPlugins`, `recentMcpPrefixes`, `recentCommands`, `totalUserCallableInvocations`, `sessionsInWindow`. Existing fields untouched — detectors remain pure functions of their context.
- **`src/cleaner.ts`** — `unused_plugin` clean/restore case added; `restoreItem` handles `disabled_plugin` manifest entries.
- **`src/cli.ts`** — restore selection UI labels disabled plugin entries as `[plugin] {name} @ {marketplace}`.
- **`src/report.ts`** — report box shows a hint line (`! N unused plugins. Run: claude-slim`) when unused plugins are detected; PLUGIN BREAKDOWN section appended after the main breakdown table.
- **`src/types.ts`** — `Issue` gains optional `marketplace?: string`; new `DisabledPluginEntry`, `AnyManifestEntry` union, and `PluginBreakdown` interface.

### Safety
- **install-mtime suppression was evaluated and rejected.** An earlier design planned to suppress "unused plugin" flags for recently installed plugins using `~/.claude/plugins/cache/` mtime as a proxy for install date. Dogfooding revealed that `claude plugin update` resets cache mtime indiscriminately, making the mtime an unreliable install timestamp. The feature was dropped before shipping. Tier 3 classification is the safety net: users always decide before anything is disabled.
- **Plugin name regex validation** (`^[a-zA-Z0-9_-]+$`) gates all `disablePlugin`/`enablePlugin` calls — any scanner or manifest corruption producing a weird name is rejected before it reaches the shell.
- **`execFile` no-shell pattern** (established in v2.2.3) reused for `disablePlugin`/`enablePlugin` — arguments are never concatenated into a shell string.

### Tests
- Total test count: **103 → 185** (+82) on the v2.5.1 baseline. After rebasing onto v2.6.1 (which added doctor-command tests), the combined suite count will reconcile during the post-merge test run.

### Docs
- README Classify table gains an `Unused plugins` row.
- README "v2.7 — What's new" section added above the existing v2.6 doctor-command notes.

## [2.6.1] — 2026-05-09

### Fixed
- README "What's new" sections now lead with v2.6 content instead of making the package page look stale after the doctor-command release.

## [2.6.0] — 2026-05-09

### Added
- `claude-slim doctor` command to check Node runtime support, `~/.claude/` readability, Claude plugin CLI availability, and recent session-log signal quality for unused-skill detection.
- `.nvmrc` and `.node-version` pin local development to Node 22.12.0, matching Vitest/Vite/Rolldown's current minimum patch requirements for the Node 22 line.

### Changed
- Safety copy now distinguishes reversible skill/project-memory moves from permanent cleanup of broken symlink files and failed-install `temp_local_*` caches.
- English, Korean, Japanese, and Chinese README usage sections document the `doctor` command and share the demo GIF presentation.
- CI and contributor docs now describe the current Node 20/22/24 matrix and supported dev-toolchain patch floors.

## [2.5.1] — 2026-05-07

### Changed
- **Demo GIF playback speed bumped to 1.5x (26s → 17s).** Sits comfortably under Twitter/X's 30s autoplay window. All four hero detector beats and the final report box remain readable. Single-line addition of `Set PlaybackSpeed 1.5` in `scripts/demo/demo.tape`.

### Safety
- Republish only — no source-code or `dist/` changes versus 2.5.0. Behavior is byte-identical for users running `npx claude-slim`. The patch exists to refresh the npmjs.com README rendering cache so the faster GIF appears on the package page.

## [2.5.0] — 2026-05-07

### Added
- **README demo GIF showing a real cleanup flow.** Replaces the static ASCII bar chart with a 26-second terminal recording: `claude-slim` runs against a synthetic `~/.claude/` producing ~11,442 tokens of overhead, surfaces 24 issues across all four hero detectors (broken_symlink, duplicate, oversized_skill, unused_skill), the user types `all`, cleanup runs, and the report box reveals "Saved: 5,616 tokens (49.1%)" with monthly $ savings.
- **`scripts/demo/`** — reproducible demo pipeline. `fixture.sh` builds an isolated synthetic environment under `/tmp/claude-slim-demo/.claude/` (refuses non-`/tmp` paths as a safety guard); `demo.tape` is a [vhs](https://github.com/charmbracelet/vhs) DSL script that scripts the recording deterministically; `bin/claude-slim` shadows the CLI to point at the local `dist/` build during recording. Re-render any time with `npm run demo` (requires `brew install vhs`).
- **`npm run demo` script** — chains `npm run build` → `bash scripts/demo/fixture.sh` → `vhs scripts/demo/demo.tape`. Output overwrites `docs/demo.gif`. Manual regeneration only — no CI auto-render.

### Changed
- **README "The problem, visualized" section** replaced with the demo GIF embedded as a centered `<img>`. Hook copy and the "Where the bloat hides" overhead table are unchanged.

### Safety
- No source-code changes. `src/`, `dist/`, and the npm `files[]` array are untouched, so users running `npx claude-slim` or installing the plugin see byte-identical behavior to v2.4.0. The demo assets ship in the GitHub repo only, not the npm package.

## [2.4.0] — 2026-04-28

### Added
- **`unused_skill` detector — flags local skills not invoked in any session within the last 60 days.** Reads `~/.claude/projects/<slug>/<sessionId>.jsonl` transcripts, looks for `Skill` tool_use events, and matches the invoked identifiers against detected local skills. The lookback window is configurable via `--lookback-days <n>` on `scan`, `clean`, and `report`. Issues are classified as Tier 3 (Optional) so they are surfaced but never auto-selected — leaves the call to the user.
- **`scanSessionUsage()` (`src/scanner/sessions.ts`)** — new module that streams JSONL transcripts and aggregates skill invocations. Per-file results are cached at `~/.claude/.skill-usage-cache.json` keyed by mtime, so warm rescans only re-read changed files. Uses the same atomic-write pattern as the token cache (write-tmp-then-rename) to survive crashes mid-flush.
- **`scan({ lookbackDays })` option** — public `scan()` API now takes an options object (default 60 days). Backward compatible: `scan()` with no args keeps prior behavior.

### Changed
- **`DetectorContext` extended** with `recentSkillInvocations`, `sessionDataAvailable`, and `lookbackDays`. The two existing core fields (`localSkills`, `pluginSkills`) and the new fields are pure inputs — detectors remain pure functions of their context.
- **Detector scope decision: only local skills are flagged unused.** Plugin skills under `~/.claude/plugins/cache/` are managed by the Claude Code plugin runtime; moving their files would partially uninstall the plugin and break `claude plugin list`. This matches the README's existing "What claude-slim never touches" promise.

### Safety
- **Hard suppression when session data is unreliable.** `unused_skill` returns nothing if (a) fewer than 3 sessions exist in the lookback window, or (b) no `Skill` tool_use events were found at all (most likely a Claude Code transcript schema change). Prevents the failure mode where a broken parser would flag every skill as unused.
- **Schema-defensive JSONL parser.** Any malformed line, unexpected shape, or missing field is silently skipped — a partial schema change degrades gracefully instead of throwing.

### Tests
- Total test count: **85 → 103** (+18). New coverage: transcript skill extraction (happy path, malformed lines, schema variations), session scanner cache hit/invalidation by mtime, lookback window cutoff, dataAvailable thresholds (sessions floor + zero-invocation floor), the `unused_skill` detector's local-only scope, and a clean+restore round-trip for `unused_skill`.

### Docs
- README detector table gains an `Unused skills` row; usage section documents `--lookback-days`.
- README "What's new" section refreshed for v2.4.
- `engines.node` raised from `>=18` to `>=20` to match the CI matrix (Node 18 was dropped from CI in v2.3.0).

## [2.3.0] — 2026-04-22

### Changed
- **Scanner split from a 588-line module into 10 focused files under `src/scanner/`**, with issue classification refactored into a detector registry pattern. Public API is unchanged — `cli.ts` and external test imports continue to work through `src/scanner.ts`, which is now a thin re-export barrel. Adding a new detection heuristic no longer requires editing the core scanner; a contributor writes a pure `Detector` function and appends it to the registry array in `src/scanner/detectors.ts`. See CONTRIBUTING.md's "Adding a New Issue Type" section for the full walkthrough.
- `DetectorContext` threads previously-module-global content cache (and all scan outputs) explicitly through detector input, removing hidden state and making detectors pure functions of their input — trivial to unit-test and reason about.

### Added
- `classifyIssues(ctx, registry?)` — exported so tests and downstream consumers can plug in custom detectors or run a subset. The built-in registry is the default; omit the second argument for current behavior.
- `Detector` / `DetectorContext` TypeScript types are now a stable contract for third-party extensions (e.g. an organization's internal heuristics).

### Tests
- Total test count: **82 → 85** (+3). New coverage: custom detector injection, tier-sort stability regardless of detector registration order, default registry behavior.

### Notes
- No runtime behavior change. Same scan inputs produce byte-identical issue output to 2.2.3. This release is a pure structural refactor to unblock community contributions and future detector work.

## [2.2.3] — 2026-04-21

### Security
- `cleanIssues` and `restoreItem` now refuse to operate on any path outside `~/.claude/`. A tampered manifest or scanner bug that produced an out-of-tree path previously flowed straight into `rename`/`rm`/`unlink`; the guard (`assertInsideClaudeDir`, `src/paths.ts`) rejects those paths up front with an explicit error. Local-only concern — not remotely exploitable — but the blast radius justified a closed gate.
- `temp_cache` cleanup now `lstat`s the target first and uses `unlink` when the path is itself a symlink. Node ≥ 18's `fs.rm` does not follow symlinks today, but encoding the invariant in our own code removes the dependency on Node-version behavior. Closes the attack scenario where a malicious plugin plants `temp_local_*` as a symlink to an external directory.
- `runCommand` switched from `child_process.exec` (shell) to `execFile` (no shell). The sole caller (`'claude plugin list'`) was never exploitable because its arguments were hardcoded, but the previous signature accepted arbitrary strings — removing the shell closes that latent injection surface for forks and future callers.

### Fixed
- `restoreItem` for skill entries now checks that (a) the disabled backup still exists and (b) the restore target is free, mirroring the `stale_project` branch. Previously a missing backup threw an opaque `ENOENT`, and a re-created skill at the original path was silently overwritten on restore.
- Breakdown table's **Saved** column was inverted — every row (`Local skills`, `System prompt`, `Memory files`, `Est. tokens`) subtracted `before - after` as `after - before`, producing negative numbers when cleanup reduced counts. The top-level `saved` field was already correct; only the per-row breakdown was wrong.
- `resolveRestoreSelection` now deduplicates repeated indices (matching `resolveSelection`). Input `"2,2,2"` used to trigger three `restoreItem` calls for the same entry, with the second and third failing noisily.
- Token cache writes (`~/.claude/.token-cache.json`) use atomic `writeFile` + `rename` instead of a direct overwrite. A crash mid-flush can no longer leave a torn JSON file.

### Changed
- `src/tokenizer.ts` now resolves the cache path lazily via `getClaudeDir()` instead of freezing it at module load. Tests that stub `HOME` now hit the tmp directory as expected; before, the tokenizer leaked into the real `~/.claude/`. In-memory cache state is also reset on every `initTokenizer()` call so repeated invocations across tests don't bleed entries.

### Tests
- Total test count: **73 → 82** (+9). New coverage: path containment, temp_cache symlink safety, skill restore existence guards, breakdown sign, restore-selection dedup, tokenizer atomic flush.

## [2.2.2] — 2026-04-20

### Changed
- `skills/claude-slim/SKILL.md` rewritten to be language-neutral. Example tables, tier labels, and the cleanup prompt are now in English; the `Language` section explicitly instructs the model to translate every user-facing string into the detected language and not to treat the English examples as a required output format. Prior versions biased non-Korean sessions toward Korean headers because the authoring templates were Korean.

## [2.2.1] — 2026-04-20

### Fixed
- `claude-slim report` pre-clean token reconstruction: previously multiplied every moved entry (except `oversized_memory`) by the per-skill prompt overhead, which double-counted `stale_project` and zero-token entries. The filter now targets skill-type entries only, and `stale_project` memory tokens are added back separately for an accurate "Before" total.
- Partial-failure orphan in `cleanIssues`: if `appendManifest` threw after a successful `rename`, the skill or stale project directory was stranded in `skills.disabled/` with no manifest record. A new `recordOrRollback` helper reverses the rename when the manifest write fails. `unlink`/`rm` paths remain best-effort with explicit comments.

### Changed
- CLI version string is now read from `package.json` at startup instead of hard-coded, so release bumps only need to edit one place.
- Magic numbers in `scanner.ts` (`10240`, `5120`, `30`) extracted to named constants (`OVERSIZED_SKILL_BYTES`, `OVERSIZED_MEMORY_BYTES`, `SKILL_PROMPT_OVERHEAD_TOKENS`). `SKILL_PROMPT_OVERHEAD_TOKENS` is exported and reused by the `report` command.
- `calculateReport` signature narrowed to `scanAfter: ScanResult` (the `null`/estimate-mode branch had no production caller).
- `temp_cache` and `broken_symlink` entries in the interactive clean list now carry a red `(permanent)` tag so users see the action is not restorable before selecting.

### Added
- `parseDisabledPlugins(output)` — pure parser extracted from `getDisabledPlugins` with unit test coverage for marketplace-suffix, fallback, mixed, case-insensitive, and dangling-status inputs.
- Rollback tests for `cleanIssues` (skill and `stale_project` paths) using `vi.spyOn(manifest, 'appendManifest')`.
- `contentCache` is now cleared at the top of each `scan()` so repeat invocations (e.g. pre/post-cleanup) don't accumulate stale entries.

### Tests
- Total test count: **66 → 73** (+7).

## [2.2.0] — 2026-04-18

### Added
- Atomic directory `rename()` for `stale_project` clean and restore — eliminates partial-failure state if the operation is interrupted mid-way.
- Clear, actionable error messages on `stale_project` collisions (cleaning onto existing backup, or restoring onto an existing target directory).
- Crash-safe manifest writes via write-to-tmp-then-rename pattern.
- Round-trip test harness (`src/__tests__/helpers/tmp-claude.ts`) backed by `tmp-promise` and `vi.stubEnv('HOME', …)` for fully isolated filesystem tests.
- Round-trip tests for every issue type: `broken_symlink`, `template`, `duplicate`, `skill_dup`, `oversized_skill`, `temp_cache`, `stale_project`.
- Manifest migration tests (legacy JSONL → v2 JSON), idempotency tests, and a 10-cycle bounded-growth test.
- `src/paths.ts` — single source of truth for `~/.claude/**` path resolution. All getters honour the `HOME` env, enabling clean test isolation.

### Changed
- **Manifest schema v2** — on-disk format changed from append-only JSONL (`.claude-slim-manifest.jsonl`) to a single JSON document (`manifest.json`) containing only currently-disabled entries. Restore removes the entry outright, so the manifest stays bounded.
- `src/cli.ts` restore flow simplified — no longer needs `action === 'restored'` filtering because v2 manifest never stores restored records.
- `src/scanner.ts`, `src/cleaner.ts`, and `src/manifest.ts` now consume `paths.ts` instead of module-level path constants.

### Fixed
- Partial-failure hazard in `stale_project` clean/restore — the per-file `readdir` + `rename` loop could leave files split between source and backup if interrupted. Replaced with a single atomic directory rename.

### Migration
- On the first run after upgrading from 2.1.x, any existing legacy manifest is auto-converted to v2. The original is preserved as `<path>.jsonl.bak`. No user action required.
- Rolling back to 2.1.x after upgrading will leave any cleans performed on 2.2.0 unrecognised by the 2.1.x CLI (their records live in `manifest.json`, not `.jsonl`). The disabled skill directories themselves are untouched — manual recovery via `~/.claude/skills.disabled/` remains possible.

### Removed
- `action?: 'restored'` field on `ManifestEntry` (no longer written; migration still reads it from legacy JSONL).

### Tests
- Total test count: **35 → 66** (+31).
- New test files: `paths.test.ts`, `manifest.test.ts`, `cleaner.test.ts`, `helpers/tmp-claude.ts`.

## [2.1.0] — 2026-04-15

- Unit tests added (60 tests with vitest).
- Symlink deduping improvements.
- Bug fixes and cleanup.

## [2.0.0] — 2026-04-13

- TypeScript CLI rewrite from bash.
- Accurate token counting via `js-tiktoken` (`cl100k_base`).
- Visual savings report box.
- `--dry-run`, `--json`, `--auto` flags.
- Token cache, standalone `npx claude-slim`.
- Disabled-plugin and stale-project detection.
- CLAUDE.md section breakdown.
