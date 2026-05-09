import { access, readdir } from 'node:fs/promises';
import { getClaudeDir, getPluginsDir, getProjectsDir, getSkillsDir } from './paths.js';
import { runCommand } from './scanner/fs-walk.js';
import { scanSessionUsage } from './scanner/sessions.js';

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  label: string;
  status: DoctorStatus;
  detail: string;
  hint?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
}

const MIN_RUNTIME_NODE_MAJOR = 20;

export function isSupportedRuntimeNode(version: string): boolean {
  const normalized = version.trim().replace(/^v/, '');
  const major = Number.parseInt(normalized.split('.')[0] || '', 10);
  return Number.isFinite(major) && major >= MIN_RUNTIME_NODE_MAJOR;
}

async function pathReadable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function countEntries(path: string): Promise<number | null> {
  try {
    return (await readdir(path)).length;
  } catch {
    return null;
  }
}

export async function collectDoctorReport(
  opts: { lookbackDays?: number } = {},
): Promise<DoctorReport> {
  const lookbackDays = opts.lookbackDays ?? 60;
  const checks: DoctorCheck[] = [];

  checks.push({
    label: 'Node.js',
    status: isSupportedRuntimeNode(process.version) ? 'ok' : 'fail',
    detail: `${process.version} (requires >=${MIN_RUNTIME_NODE_MAJOR})`,
    hint: isSupportedRuntimeNode(process.version)
      ? undefined
      : 'Install Node.js 20 or newer.',
  });

  const claudeDir = getClaudeDir();
  const claudeDirReadable = await pathReadable(claudeDir);
  checks.push({
    label: 'Claude directory',
    status: claudeDirReadable ? 'ok' : 'fail',
    detail: claudeDir,
    hint: claudeDirReadable ? undefined : 'Run Claude Code once so ~/.claude is created.',
  });

  const skillCount = await countEntries(getSkillsDir());
  checks.push({
    label: 'Local skills directory',
    status: skillCount === null ? 'warn' : 'ok',
    detail: skillCount === null ? `${getSkillsDir()} not readable` : `${skillCount} entries`,
    hint: skillCount === null ? 'No local skills were found or the directory is not readable.' : undefined,
  });

  const pluginCount = await countEntries(getPluginsDir());
  checks.push({
    label: 'Plugin cache directory',
    status: pluginCount === null ? 'warn' : 'ok',
    detail: pluginCount === null ? `${getPluginsDir()} not readable` : `${pluginCount} entries`,
    hint: pluginCount === null ? 'Install a Claude Code plugin if you expect plugin-skill scanning.' : undefined,
  });

  const pluginListOutput = await runCommand('claude', ['plugin', 'list']);
  checks.push({
    label: 'Claude plugin CLI',
    status: pluginListOutput.trim() ? 'ok' : 'warn',
    detail: pluginListOutput.trim() ? 'claude plugin list returned output' : 'no output from claude plugin list',
    hint: pluginListOutput.trim()
      ? undefined
      : 'Install or sign in to Claude Code if disabled-plugin detection looks incomplete.',
  });

  const projectsReadable = await pathReadable(getProjectsDir());
  if (!projectsReadable) {
    checks.push({
      label: 'Session transcripts',
      status: 'warn',
      detail: `${getProjectsDir()} not readable`,
      hint: 'Unused-skill detection needs recent ~/.claude/projects/*.jsonl session logs.',
    });
  } else {
    const usage = await scanSessionUsage(lookbackDays);
    checks.push({
      label: 'Session transcripts',
      status: usage.dataAvailable ? 'ok' : 'warn',
      detail: `${usage.sessionsInWindow} sessions in last ${lookbackDays}d, ${usage.invokedSkills.size} invoked skills`,
      hint: usage.dataAvailable
        ? undefined
        : 'Unused-skill detection will be suppressed until enough reliable session data exists.',
    });
  }

  return { checks };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = ['', '\x1b[1m=== claude-slim doctor ===\x1b[0m', ''];
  const symbols: Record<DoctorStatus, string> = {
    ok: '\x1b[32m✓\x1b[0m',
    warn: '\x1b[33m!\x1b[0m',
    fail: '\x1b[31m✗\x1b[0m',
  };

  for (const check of report.checks) {
    lines.push(`  ${symbols[check.status]} ${check.label}: ${check.detail}`);
    if (check.hint && check.status !== 'ok') {
      lines.push(`      ${check.hint}`);
    }
  }

  const failed = report.checks.filter((c) => c.status === 'fail').length;
  const warned = report.checks.filter((c) => c.status === 'warn').length;
  lines.push('');
  if (failed > 0) {
    lines.push(`  ${failed} failing check(s), ${warned} warning(s).`);
  } else if (warned > 0) {
    lines.push(`  No failing checks. ${warned} warning(s) may reduce scan fidelity.`);
  } else {
    lines.push('  All checks passed.');
  }
  lines.push('');

  return lines.join('\n');
}
