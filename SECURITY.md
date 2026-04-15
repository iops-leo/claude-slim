# Security Policy

## Scope

claude-slim operates exclusively on local files under `~/.claude/`. It does not make network requests, collect telemetry, or access external services (except `claude plugin list` which is a local CLI command).

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x     | Yes       |
| 1.x     | No        |

## Reporting a Vulnerability

If you discover a security issue, please report it privately:

- **Email**: leo.new@kakaoent.com
- **Subject**: `[claude-slim] Security: <brief description>`

Please do **not** open a public issue for security vulnerabilities.

You can expect an initial response within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Security Considerations

- **No deletion**: claude-slim moves files to `~/.claude/skills.disabled/`, never deletes source files (except broken symlinks and temp caches).
- **No code execution**: The scanner reads files and metadata only. It does not execute skill contents.
- **Token cache**: Stored locally at `~/.claude/.token-cache.json`. Contains MD5 hashes and token counts, no file contents.
- **Manifest**: `~/.claude/skills.disabled/.claude-slim-manifest.jsonl` logs what was disabled and when. Contains file paths only.
