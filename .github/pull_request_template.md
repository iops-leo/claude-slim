<!--
Thanks for opening a PR! A short description + the checklist below keep review fast.
Delete any section that does not apply.
-->

## What & why

<!-- 1-3 sentences: what does this PR change, and why is it worth changing? Link the issue if there is one. -->

## Test plan

<!--
- New/updated tests? Which files?
- Manual verification steps (e.g. `npm test`, `npx claude-slim scan` on a real ~/.claude/)?
- Screenshots or before/after output for CLI-visible changes.
-->

## Checklist

- [ ] `npm test` passes locally
- [ ] `npm run build` produces a clean `dist/` (committed)
- [ ] `CHANGELOG.md` updated under `## [Unreleased]` (or a new `## [X.Y.Z] — YYYY-MM-DD` section for a release PR)
- [ ] Public API / CLI-visible behavior changes documented in `README.md` (and translations if user-facing)
- [ ] No unrelated refactors mixed in (keep diffs reviewable)

## Notes for reviewer

<!-- Anything the reviewer should look at extra carefully, or trade-offs you consciously accepted. -->
