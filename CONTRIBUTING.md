# Contributing to claude-slim

Thanks for your interest in contributing!

## Getting Started

```bash
git clone https://github.com/iops-leo/claude-slim.git
cd claude-slim
nvm use
npm install
npm run build
npm test
```

## Development

```bash
npm run dev          # Watch mode (rebuilds on change)
npm test             # Run tests once
npm run test:watch   # Watch mode tests
```

## Project Structure

```
src/
  cli.ts          # CLI entry point (commander)
  scanner.ts      # Environment scanning & issue classification
  cleaner.ts      # Move/delete/restore operations (path-guarded)
  report.ts       # Savings calculation & formatting
  tokenizer.ts    # Token counting with cache (js-tiktoken, cl100k_base)
  manifest.ts     # v2 JSON manifest for disabled items (atomic writes)
  selection.ts    # User input parsing helpers
  paths.ts        # ~/.claude/ path resolution + containment guard
  types.ts        # Shared TypeScript types
  __tests__/      # Unit tests (vitest)

skills/claude-slim/
  SKILL.md        # Claude Code skill instructions
  scripts/
    scan.sh       # Legacy bash scanner (fallback when Node isn't available)
```

## Making Changes

1. Create a branch from `main`.
2. **Write the test first.** Bug fixes and features land via TDD — red test, then green code. See `src/__tests__/cleaner.test.ts` for the round-trip pattern.
3. Run `npm run build` to compile.
4. Run `npm test` to verify. CI runs on Node 20, 22, and 24. Local development should use the version pinned in `.nvmrc` / `.node-version` because Vitest 4's Vite/Rolldown stack requires Node 20.19+ or 22.12+.
5. Test the CLI: `node dist/cli.js scan`.
6. Submit a PR.

## Good First Issues

If you're looking for a place to start, check the [`good first issue`](https://github.com/iops-leo/claude-slim/labels/good%20first%20issue) label. Good entry points:

- **Add a new detection heuristic** — see "Adding a new issue type" below.
- **Improve a report string** — `src/report.ts` has the formatting logic; changes are easy to test end-to-end.
- **Expand test helpers** — `src/__tests__/helpers/tmp-claude.ts` has `writeSkill` / `writeTempCache` / `writeStaleProject` / `writeBrokenSymlink` / `writeSymlinkDir`. New helpers unblock new tests.
- **Translate the README** — `docs/README.*.md` are welcome in any language.

## Adding a New Issue Type

1. Add the new kind to `IssueType` in `src/types.ts`.
2. Write a `Detector` in `src/scanner/detectors.ts` and append it to the `detectors` array. Use an existing detector (e.g., `oversizedSkillDetector`) as a template — each detector is a pure function of `DetectorContext`. If your detector needs data the existing context doesn't carry, extend `DetectorContext` with a new field, populate it in `src/scanner/index.ts`, and update the `makeCtx` helper in `src/__tests__/scanner.test.ts` so existing tests still typecheck.
3. Decide how `src/cleaner.ts:cleanIssues` should act on it. Reuse an existing branch if the action is `rename-to-disabled`, or add one for a new action — **always call `assertInsideClaudeDir(issue.path)` first** (the loop already does this, so you're covered).
4. If the action is reversible, implement the corresponding branch in `restoreItem` (mirror the skill or `stale_project` branch — both check that the backup exists and the target is free).
5. Add a round-trip test in `src/__tests__/cleaner.test.ts` that cleans then restores and asserts filesystem state at each step.
6. Update the issue table in `README.md` (and the i18n READMEs under `docs/` if you can).

## Guidelines

- Keep changes focused. One feature or fix per PR.
- Add tests for new logic in `src/__tests__/`.
- **Never bypass the path-containment guard** (`assertInsideClaudeDir`). All destructive operations must go through it.
- Don't break the bash scanner (`skills/claude-slim/scripts/scan.sh`) — it's the fallback when Node isn't available.
- `dist/` is committed (marketplace installs need compiled JS). Run `npm run build` before committing.

## Reporting Issues

Open an issue on GitHub with:
- What you expected
- What happened
- Your environment (OS, Node version, Claude Code version)

Templates for bug reports and feature requests are available when you click **New issue**.
