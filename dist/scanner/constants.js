export const STALE_DAYS = 90;
export const OVERSIZED_SKILL_BYTES = 10240;
export const OVERSIZED_MEMORY_BYTES = 5120;
export const SKILL_PROMPT_OVERHEAD_TOKENS = 30;
// Calibrated from owner system prompt sample:
// Deferred tools list ~1500 tokens / ~209 MCP tools ≈ 7.2 tok/tool → rounded up to 8.
export const DEFERRED_TOOL_OVERHEAD_TOKENS = 8;
// Estimated from slash-command list format in system prompt: ~10 tok/command.
export const COMMAND_OVERHEAD_TOKENS = 10;
// Average tools per MCP server (used when per-server tool count is unknown).
// Most plugin MCP servers expose 5–15 tools; 10 is a reasonable midpoint.
export const MCP_SERVER_TOOLS_AVG = 10;
// Auto-memory: only the index is loaded at session start, and only its first
// 200 lines or 25KB, whichever comes first. Topic files are read on demand.
// Source: https://code.claude.com/docs/en/memory.md
export const MEMORY_INDEX_FILE = 'MEMORY.md';
export const MEMORY_INDEX_MAX_LINES = 200;
export const MEMORY_INDEX_MAX_BYTES = 25 * 1024;
// `@path` imports in CLAUDE.md recurse at most this many hops.
export const CLAUDE_MD_IMPORT_MAX_DEPTH = 4;
