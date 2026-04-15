# Contributing to claude-slim

Thanks for your interest in contributing!

## Getting Started

```bash
git clone https://github.com/iops-leo/claude-slim.git
cd claude-slim
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
  cleaner.ts      # Move/delete/restore operations
  report.ts       # Savings calculation & formatting
  tokenizer.ts    # Token counting with cache
  manifest.ts     # JSONL manifest for disabled items
  selection.ts    # User input parsing helpers
  types.ts        # Shared TypeScript types
  __tests__/      # Unit tests (vitest)

skills/claude-slim/
  SKILL.md        # Claude Code skill instructions
  scripts/
    scan.sh       # Legacy bash scanner (fallback)
```

## Making Changes

1. Create a branch from `main`
2. Make your changes in `src/`
3. Run `npm run build` to compile
4. Run `npm test` to verify
5. Test the CLI: `node dist/cli.js scan`
6. Submit a PR

## Guidelines

- Keep changes focused. One feature or fix per PR.
- Add tests for new logic in `src/__tests__/`.
- Don't break the bash scanner (`scripts/scan.sh`) — it's the fallback when Node isn't available.
- `dist/` is committed (marketplace installs need compiled JS). Run `npm run build` before committing.

## Reporting Issues

Open an issue on GitHub with:
- What you expected
- What happened
- Your environment (OS, Node version, Claude Code version)
