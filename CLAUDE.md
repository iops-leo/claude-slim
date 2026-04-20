# claude-slim — Claude context

This file is loaded by Claude Code sessions running in this repo.
Keep it short; link out to runbooks instead of inlining.

## Project summary

claude-slim scans `~/.claude/**` for skill/plugin/memory bloat and either
reports or cleans it up. TypeScript CLI, tested with vitest, published to
npm as `claude-slim`.

- Source: `src/**` (build with `npm run build`, tests with `npm test`)
- Ship artifact: `dist/**` (committed so `npx claude-slim` works without a build step)
- Release channel: npm registry, OIDC Trusted Publisher

## Runbooks

- **Release process:** [`docs/internal/release.md`](docs/internal/release.md)
  — how to cut a new version (bump → tag → push), Trusted Publisher config,
  troubleshooting the GitHub Actions workflow.

## Conventions

- Bug fixes and small hardening land as `fix:` / `chore:` commits; refactors as `refactor:`.
- Every release ships: `package.json` version bump, `CHANGELOG.md` entry with `### Fixed|Changed|Added`, updated `package-lock.json`, a matching `vX.Y.Z` annotated tag.
- `docs/internal/` and other personal runbooks are gitignored — treat them as local-only context for future Claude sessions.
