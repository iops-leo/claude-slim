# Security Policy

## Supported versions

Only the latest published version of `claude-slim` receives fixes. Upgrade with
`npm install -g claude-slim@latest` or re-run `npx claude-slim`.

## Reporting a vulnerability

Report privately via [GitHub Security Advisories](https://github.com/iops-leo/claude-slim/security/advisories/new).
Please do not open a public issue for a suspected vulnerability.

Include the claude-slim version (`npx claude-slim --version`), your OS and Node
version, and the steps to reproduce. Expect an initial response within a week.

## Threat model

claude-slim reads and moves files inside `~/.claude/`. The security-relevant
guarantees it aims to hold:

- **Path containment.** Every destructive operation is refused if the resolved
  target escapes `~/.claude/` (`assertInsideClaudeDir`), including when a
  tampered `skills.disabled/manifest.json` asks for it.
- **No shell interpolation.** External commands run through `execFile`, never a
  shell, so filenames cannot be read as shell metacharacters.
- **No symlink traversal on delete.** `temp_cache` removal unlinks a symlink
  rather than following it into its target.
- **No network access.** claude-slim makes no outbound requests. It never reads
  your project source, only `~/.claude/`.
- **Read-only surfaces.** `CLAUDE.md`, `settings.json`, plugin configs, and
  `~/.claude/agents/` are measured but never modified.

A bypass of any of the above is a vulnerability. So is anything that causes data
loss outside the documented cleanup set, or that makes `restore` unable to
recover a moved skill.
