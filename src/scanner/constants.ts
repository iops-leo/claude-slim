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
