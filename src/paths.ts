import { homedir } from 'node:os';
import { join } from 'node:path';

export function getClaudeDir(): string {
  return join(homedir(), '.claude');
}

export function getSkillsDir(): string {
  return join(getClaudeDir(), 'skills');
}

export function getPluginsDir(): string {
  return join(getClaudeDir(), 'plugins', 'cache');
}

export function getProjectsDir(): string {
  return join(getClaudeDir(), 'projects');
}

export function getDisabledDir(): string {
  return join(getClaudeDir(), 'skills.disabled');
}

export function getManifestPath(): string {
  return join(getDisabledDir(), 'manifest.json');
}

export function getLegacyManifestPath(): string {
  return join(getDisabledDir(), '.claude-slim-manifest.jsonl');
}
