#!/usr/bin/env node
// Guards against the drift that shipped v2.7.1 → v2.7.3 with the plugin
// manifests still advertising 2.7.0: `claude plugin install` reads
// .claude-plugin/*, not package.json, so plugin users saw a stale version for
// three releases. Run in CI and before publishing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(relPath) {
  return JSON.parse(readFileSync(join(repoRoot, relPath), 'utf-8'));
}

const expected = read('package.json').version;

const checks = [
  ['.claude-plugin/plugin.json', (j) => j.version],
  ['.claude-plugin/marketplace.json', (j) => j.metadata?.version],
];

const mismatches = [];
for (const [relPath, pick] of checks) {
  const actual = pick(read(relPath));
  if (actual !== expected) {
    mismatches.push(`  ${relPath}: ${actual ?? '(missing)'} !== ${expected}`);
  }
}

if (mismatches.length > 0) {
  console.error(`Version mismatch against package.json (${expected}):`);
  console.error(mismatches.join('\n'));
  console.error('\nBump every manifest together, then re-run.');
  process.exit(1);
}

console.log(`Version sync OK — all manifests at ${expected}`);
