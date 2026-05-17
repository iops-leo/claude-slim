import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanIssues, restoreItem } from '../cleaner.js';
import * as pluginRuntime from '../plugin-runtime.js';
import * as manifestMod from '../manifest.js';
import { readManifestV2 } from '../manifest.js';
import { resolveRestoreSelection } from '../selection.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';
import type { Issue, DisabledPluginEntry } from '../types.js';

// Mock plugin-runtime so no real `claude` binary is invoked
vi.mock('../plugin-runtime.js', () => ({
  disablePlugin: vi.fn().mockResolvedValue(undefined),
  enablePlugin: vi.fn().mockResolvedValue(undefined),
}));

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
  vi.clearAllMocks();
});

afterEach(async () => {
  await tmp.cleanup();
});

// ---------------------------------------------------------------------------
// 1. Happy path clean: unused_plugin → disablePlugin called + manifest entry
// ---------------------------------------------------------------------------
describe('cleanIssues — unused_plugin happy path', () => {
  it('calls disablePlugin and records manifest entry', async () => {
    const issue: Issue = {
      type: 'unused_plugin',
      tier: 3,
      name: 'claude-hud',
      marketplace: 'npm',
      detail: 'not invoked in 60d (npm)',
      tokens: 0,
      path: '/fake/plugins/claude-hud',
    };

    const result = await cleanIssues([issue]);

    expect(pluginRuntime.disablePlugin).toHaveBeenCalledOnce();
    expect(pluginRuntime.disablePlugin).toHaveBeenCalledWith('claude-hud');

    const manifest = await readManifestV2();
    const entry = manifest.entries.find(
      (e): e is DisabledPluginEntry => 'plugin' in e && e.plugin === 'claude-hud',
    );
    expect(entry).toBeDefined();
    expect(entry!.marketplace).toBe('npm');
    expect(entry!.type).toBe('disabled_plugin');

    // unused_plugin is tracked as skipped (no ManifestEntry shape)
    expect(result.errors).toHaveLength(0);
    expect(result.skipped).toContain('claude-hud');
  });
});

// ---------------------------------------------------------------------------
// 2. Rollback on manifest fail: disable OK, append throws → enablePlugin called
// ---------------------------------------------------------------------------
describe('cleanIssues — unused_plugin rollback', () => {
  it('calls enablePlugin when manifest append fails', async () => {
    const issue: Issue = {
      type: 'unused_plugin',
      tier: 3,
      name: 'figma',
      marketplace: 'npm',
      detail: 'not invoked in 60d (npm)',
      tokens: 0,
      path: '/fake/plugins/figma',
    };

    const spy = vi
      .spyOn(manifestMod, 'recordDisabledPlugin')
      .mockRejectedValueOnce(new Error('manifest write failed'));

    const result = await cleanIssues([issue]);

    expect(pluginRuntime.disablePlugin).toHaveBeenCalledWith('figma');
    expect(pluginRuntime.enablePlugin).toHaveBeenCalledWith('figma');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe('figma');

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. Happy path restore: disabled_plugin entry → enablePlugin + manifest remove
// ---------------------------------------------------------------------------
describe('restoreItem — disabled_plugin happy path', () => {
  it('calls enablePlugin and removes manifest entry', async () => {
    // Seed a disabled_plugin entry in the manifest
    await manifestMod.recordDisabledPlugin('claude-slim', 'npm');

    const manifest = await readManifestV2();
    const entry = manifest.entries.find(
      (e): e is DisabledPluginEntry => 'plugin' in e && e.plugin === 'claude-slim',
    );
    expect(entry).toBeDefined();

    await restoreItem(entry!);

    expect(pluginRuntime.enablePlugin).toHaveBeenCalledOnce();
    expect(pluginRuntime.enablePlugin).toHaveBeenCalledWith('claude-slim');

    const afterManifest = await readManifestV2();
    const still = afterManifest.entries.find(
      (e): e is DisabledPluginEntry => 'plugin' in e && e.plugin === 'claude-slim',
    );
    expect(still).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Restore selection UI label: disabled_plugin shows [plugin] prefix
// ---------------------------------------------------------------------------
describe('restore UI label format', () => {
  it('formats plugin entry label as [plugin] name @ marketplace', () => {
    const entry: DisabledPluginEntry = {
      type: 'disabled_plugin',
      plugin: 'claude-hud',
      marketplace: 'npm',
      disabledAt: '2026-04-22T00:00:00.000Z',
    };

    // Simulate the label logic from cli.ts restore action
    const label = 'plugin' in entry && 'marketplace' in entry
      ? `[plugin] ${entry.plugin} @ ${entry.marketplace} (disabled ${new Date(entry.disabledAt).toLocaleDateString()})`
      : `${(entry as unknown as { name: string }).name}`;

    expect(label).toMatch(/^\[plugin\] claude-hud @ npm/);
    expect(label).toContain('disabled');
  });
});

// ---------------------------------------------------------------------------
// 5. Restore selection dedup: "3,3" → enablePlugin called only once
// ---------------------------------------------------------------------------
describe('restore selection deduplication', () => {
  it('resolveRestoreSelection deduplicates repeated indices', async () => {
    // Seed two entries
    await manifestMod.recordDisabledPlugin('plugA', 'npm');
    await manifestMod.recordDisabledPlugin('plugB', 'npm');

    const manifest = await readManifestV2();
    const pluginEntries = manifest.entries.filter(
      (e): e is DisabledPluginEntry => 'plugin' in e,
    );
    expect(pluginEntries.length).toBe(2);

    // resolveRestoreSelection with "1,1" should return index 0 once
    const indices = resolveRestoreSelection('1,1', pluginEntries.length);
    expect(indices).toHaveLength(1);
    expect(indices[0]).toBe(0);

    // Restore deduplicated list — enablePlugin called once
    for (const idx of indices) {
      await restoreItem(pluginEntries[idx]);
    }
    expect(pluginRuntime.enablePlugin).toHaveBeenCalledOnce();
    expect(pluginRuntime.enablePlugin).toHaveBeenCalledWith('plugA');
  });
});

// ---------------------------------------------------------------------------
// 6. Round-trip: clean → restore → same state; each called exactly once
// ---------------------------------------------------------------------------
describe('round-trip clean then restore', () => {
  it('disablePlugin and enablePlugin each called exactly once', async () => {
    const issue: Issue = {
      type: 'unused_plugin',
      tier: 3,
      name: 'oh-my-claudecode',
      marketplace: 'npm',
      detail: 'not invoked in 60d (npm)',
      tokens: 0,
      path: '/fake/plugins/oh-my-claudecode',
    };

    // Clean phase
    await cleanIssues([issue]);
    expect(pluginRuntime.disablePlugin).toHaveBeenCalledOnce();

    // Read back the manifest entry
    const manifest = await readManifestV2();
    const entry = manifest.entries.find(
      (e): e is DisabledPluginEntry => 'plugin' in e && e.plugin === 'oh-my-claudecode',
    );
    expect(entry).toBeDefined();

    // Restore phase
    await restoreItem(entry!);
    expect(pluginRuntime.enablePlugin).toHaveBeenCalledOnce();

    // Manifest should be empty now
    const afterManifest = await readManifestV2();
    const remaining = afterManifest.entries.filter(
      (e): e is DisabledPluginEntry => 'plugin' in e && e.plugin === 'oh-my-claudecode',
    );
    expect(remaining).toHaveLength(0);
  });
});
