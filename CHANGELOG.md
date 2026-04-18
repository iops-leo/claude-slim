# Changelog

All notable changes to claude-slim are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
