import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  recordDisabledPlugin,
  findDisabledPlugin,
  removeDisabledPlugin,
  readManifestV2,
} from '../manifest.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';

let tmp: TmpClaude;

beforeEach(async () => {
  tmp = await createTmpClaude();
});

afterEach(async () => {
  await tmp.cleanup();
});

describe('disabled_plugin manifest entries', () => {
  it('append: recordDisabledPlugin writes a new entry to manifest', async () => {
    await recordDisabledPlugin('foo', 'bar');
    const m = await readManifestV2();
    expect(m.entries).toHaveLength(1);
    const e = m.entries[0];
    expect(e.type).toBe('disabled_plugin');
    if (e.type === 'disabled_plugin' && 'plugin' in e) {
      expect(e.plugin).toBe('foo');
      expect(e.marketplace).toBe('bar');
      expect(typeof e.disabledAt).toBe('string');
    }
  });

  it('find: findDisabledPlugin returns the entry after recording', async () => {
    await recordDisabledPlugin('foo', 'bar');
    const found = await findDisabledPlugin('foo', 'bar');
    expect(found).toBeDefined();
    expect(found!.plugin).toBe('foo');
    expect(found!.marketplace).toBe('bar');
  });

  it('find none: findDisabledPlugin returns undefined for unknown plugin', async () => {
    const found = await findDisabledPlugin('nonexistent', 'bar');
    expect(found).toBeUndefined();
  });

  it('remove: removeDisabledPlugin removes the entry from manifest', async () => {
    await recordDisabledPlugin('foo', 'bar');
    const result = await removeDisabledPlugin('foo', 'bar');
    expect(result).toBe(true);
    const m = await readManifestV2();
    expect(m.entries).toHaveLength(0);
  });

  it('migration: manifest with only disabled_plugin entries survives round-trip', async () => {
    // Simulate forward-compat: a manifest.json that already contains a disabled_plugin entry
    // (written by a newer version) is read back correctly by readManifestV2.
    await recordDisabledPlugin('oh-my-claudecode', 'omc');
    const m = await readManifestV2();
    expect(m.version).toBe(2);
    const entry = m.entries.find((e) => e.type === 'disabled_plugin' && 'plugin' in e && e.plugin === 'oh-my-claudecode');
    expect(entry).toBeDefined();
  });

  it('complex key: same plugin name in different marketplaces are independent', async () => {
    await recordDisabledPlugin('foo', 'marketplace-a');
    await recordDisabledPlugin('foo', 'marketplace-b');

    const foundA = await findDisabledPlugin('foo', 'marketplace-a');
    const foundB = await findDisabledPlugin('foo', 'marketplace-b');
    expect(foundA).toBeDefined();
    expect(foundB).toBeDefined();
    expect(foundA!.marketplace).toBe('marketplace-a');
    expect(foundB!.marketplace).toBe('marketplace-b');

    // Remove only one, the other persists
    await removeDisabledPlugin('foo', 'marketplace-a');
    expect(await findDisabledPlugin('foo', 'marketplace-a')).toBeUndefined();
    expect(await findDisabledPlugin('foo', 'marketplace-b')).toBeDefined();
  });
});
