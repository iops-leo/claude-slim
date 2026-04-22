// Public barrel — keeps the previously-exported surface stable while the
// implementation lives in src/scanner/*. External importers (cli.ts, tests,
// future consumers) do not need to know about the split.
export { scan } from './scanner/index.js';
export { SKILL_PROMPT_OVERHEAD_TOKENS } from './scanner/constants.js';
export { dedupeBySymlink } from './scanner/local-skills.js';
export { parseDisabledPlugins } from './scanner/disabled-plugins.js';
export { parseClaudeMdSections } from './scanner/claude-md.js';
