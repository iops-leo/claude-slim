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

// The skill's npx tier must name the exact release it ships with, not just the
// major. npx reuses any cached _npx install satisfying the range and never
// re-checks the registry, so `claude-slim@^2` pins a skills.sh user to whatever
// 2.x they fetched first — a security release would never reach them. Moving the
// pin every release changes the cache key and forces a fresh fetch.
const SKILL_MD = 'skills/claude-slim/SKILL.md';
const PIN_RE = /'claude-slim@\^([0-9]+\.[0-9]+\.[0-9]+)'/g;

const mismatches = [];
for (const [relPath, pick] of checks) {
  const actual = pick(read(relPath));
  if (actual !== expected) {
    mismatches.push(`  ${relPath}: ${actual ?? '(missing)'} !== ${expected}`);
  }
}

const skillMd = readFileSync(join(repoRoot, SKILL_MD), 'utf-8');
const pins = [...skillMd.matchAll(PIN_RE)].map((m) => m[1]);

if (pins.length === 0) {
  mismatches.push(`  ${SKILL_MD}: no 'claude-slim@^x.y.z' npx pin found`);
} else {
  const wrong = [...new Set(pins.filter((v) => v !== expected))];
  if (wrong.length > 0) {
    mismatches.push(`  ${SKILL_MD}: npx pin ${wrong.join(', ')} !== ${expected}`);
  }
}

if (mismatches.length > 0) {
  console.error(`Version mismatch against package.json (${expected}):`);
  console.error(mismatches.join('\n'));
  console.error('\nBump every manifest together, then re-run.');
  process.exit(1);
}

console.log(`Version sync OK — all manifests and the SKILL.md npx pin at ${expected}`);
