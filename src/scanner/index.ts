import { join } from 'node:path';
import { countTokensCached } from '../tokenizer.js';
import { getClaudeDir } from '../paths.js';
import type { ScanResult } from '../types.js';
import { safeReadFile } from './fs-walk.js';
import { scanLocalSkills } from './local-skills.js';
import { scanPluginSkills } from './plugin-skills.js';
import { scanMemoryFiles } from './memory.js';
import { scanMcpServers } from './mcp.js';
import { parseClaudeMdSections } from './claude-md.js';
import { getDisabledPlugins } from './disabled-plugins.js';
import { scanSessionUsage } from './sessions.js';
import { classifyIssues } from './detectors.js';
import { SKILL_PROMPT_OVERHEAD_TOKENS } from './constants.js';

export interface ScanOptions {
  // Days of session history to consider when classifying skills as unused.
  // Default 60: long enough to absorb a month-off-then-resume cadence,
  // short enough that "stale by inactivity" remains meaningful.
  lookbackDays?: number;
}

const DEFAULT_LOOKBACK_DAYS = 60;

export async function scan(opts: ScanOptions = {}): Promise<ScanResult> {
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const [
    { skills: localSkills, brokenSymlinks, contents },
    { skills: pluginSkills, plugins, tempCaches },
    { memoryFiles, staleProjects },
    mcp,
    disabledPlugins,
    sessionUsage,
  ] = await Promise.all([
    scanLocalSkills(),
    scanPluginSkills(),
    scanMemoryFiles(),
    scanMcpServers(),
    getDisabledPlugins(),
    scanSessionUsage(lookbackDays),
  ]);

  // Annotate plugin status
  for (const plugin of plugins) {
    plugin.status = disabledPlugins.has(plugin.name) ? 'disabled' : 'enabled';
  }

  // CLAUDE.md
  const claudeMdContent = await safeReadFile(join(getClaudeDir(), 'CLAUDE.md'));
  const claudeMdBytes = claudeMdContent ? Buffer.byteLength(claudeMdContent) : 0;
  const claudeMdTokens = claudeMdContent
    ? countTokensCached(claudeMdContent, join(getClaudeDir(), 'CLAUDE.md'))
    : 0;
  const claudeMdSections = claudeMdContent ? parseClaudeMdSections(claudeMdContent) : [];

  const issues = classifyIssues({
    localSkills, pluginSkills, brokenSymlinks, memoryFiles,
    tempCaches, staleProjects, disabledPlugins, plugins,
    contents,
    recentSkillInvocations: sessionUsage.invokedSkills,
    sessionDataAvailable: sessionUsage.dataAvailable,
    lookbackDays,
  });

  // Estimate total tokens at startup
  const skillListingTokens =
    (localSkills.length + pluginSkills.length) * SKILL_PROMPT_OVERHEAD_TOKENS;
  const memoryTokens = memoryFiles.reduce((sum, m) => sum + m.tokens, 0);
  const totalTokensBefore = skillListingTokens + claudeMdTokens + memoryTokens;

  return {
    localSkills,
    pluginSkills,
    plugins,
    brokenSymlinks,
    memoryFiles,
    claudeMdBytes,
    claudeMdTokens,
    claudeMdSections,
    mcpServers: mcp.count,
    mcpServerNames: mcp.names,
    issues,
    totalTokensBefore,
  };
}
