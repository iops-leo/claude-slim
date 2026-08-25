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

## Version bumps touch three manifests

`package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
(`metadata.version`), and the seven `claude-slim@^x.y.z` npx pins in
`skills/claude-slim/SKILL.md` must all move together. `claude plugin install` reads the
plugin manifests, not `package.json` — drift here shipped a stale version to
plugin users for three releases before anyone noticed.

The SKILL.md pin is not decoration. npx reuses any cached `_npx` install that
satisfies the range and never re-checks the registry, so a major-only `@^2` strands
skills.sh users on whatever 2.x they fetched first — v2.14.1's security fix reached
none of them until the pin moved. `--prefer-online` does not override this.

Run `npm run check:versions` to verify. It is wired into CI and `prepublishOnly`.

## README changes are a set of four — this gets forgotten every time

`README.md` plus `docs/README.ko.md`, `docs/README.ja.md`, `docs/README.zh.md`.
Editing one and not the rest has happened repeatedly, in both directions: the
translations lagging the English, and the English lagging the translations.

**Before committing any README edit, diff all four for the thing you changed.**
Cheap check:

```bash
for f in README.md docs/README.*.md; do
  printf "%-22s %s\n" "$f" "$(grep -oE '^## v[0-9]+\.[0-9]+\.[0-9]+' "$f" | head -1)"
done
```

Content that must exist in all four: the latest release section, the usage
command list, the "never touches" safety rows, and the `~/.claude/` tree.

All four keep **only the latest** release section; older notes live in
`CHANGELOG.md` and are linked from the bottom of each. Do not restore a history
stack in the translations — it was removed precisely because keeping four
copies of the changelog in sync is what caused the drift above.
