import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDisabledPlugins } from '../scanner/disabled-plugins.js';
import { scan } from '../scanner/index.js';
import { formatScanSummary } from '../report.js';
import { initTokenizer } from '../tokenizer.js';
import { createTmpClaude, type TmpClaude } from './helpers/tmp-claude.js';

/**
 * Enable state is per plugin, not per marketplace. Collapsing to the
 * marketplace marked every plugin from it disabled when one was, and PLUGINS
 * listed marketplace names ("cursor-plugins 58") while PLUGIN BREAKDOWN listed
 * plugin names ("pstack 58").
 */

const LIST = [
  'Installed plugins:',
  '',
  '  ❯ myplug@mkt',
  '    Version: 1.0.0',
  '    Status: ✔ enabled',
  '',
  '  ❯ offplug@mkt',
  '    Version: 1.0.0',
  '    Status: ✘ disabled',
  '',
].join('\n');

describe('parseDisabledPlugins', () => {
  it('keys by plugin@marketplace, so a sibling in the same marketplace stays enabled', () => {
    const d = parseDisabledPlugins(LIST);
    expect([...d]).toEqual(['offplug@mkt']);
  });

  it('treats a plugin enabled in any scope as enabled', () => {
    const out = '❯ a@m\n  disabled\n❯ a@m\n  enabled\n❯ b@m\n  disabled\n';
    expect([...parseDisabledPlugins(out)]).toEqual(['b@m']);
  });
});

describe('scan and report — plugins by name, state per plugin', () => {
  let tmp: TmpClaude;
  beforeAll(async () => { await initTokenizer(); });
  beforeEach(async () => {
    tmp = await createTmpClaude();
    const bin = join(tmp.home, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'claude'), `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then cat <<'EOT'\n${LIST}\nEOT\nfi\n`);
    await chmod(join(bin, 'claude'), 0o755);
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
    for (const p of ['myplug', 'offplug']) {
      const d = join(tmp.pluginsDir, 'mkt', p, '1.0.0', 'skills', `s-${p}`);
      await mkdir(d, { recursive: true });
      await writeFile(join(d, 'SKILL.md'), `---\nname: s-${p}\ndescription: skill of ${p}\n---\nbody\n`);
    }
  });
  afterEach(async () => { await tmp.cleanup(); });

  it('lists each plugin with its own status and flags only the disabled one', async () => {
    const result = await scan({ lookbackDays: 60 });
    const plugins = [...result.plugins].sort((a, b) => a.name.localeCompare(b.name));
    expect(plugins.map((p) => [p.name, p.marketplace, p.status])).toEqual([
      ['myplug', 'mkt', 'enabled'],
      ['offplug', 'mkt', 'disabled'],
    ]);
    const disabled = result.issues.filter((i) => i.type === 'disabled_plugin');
    expect(disabled.map((i) => [i.name, i.marketplace])).toEqual([['offplug', 'mkt']]);

    const text = formatScanSummary(result);
    const pluginsSection = text.slice(text.indexOf('PLUGINS'), text.indexOf('CLAUDE.MD'));
    expect(pluginsSection).toMatch(/myplug\s+1 skills/);
    expect(pluginsSection).toMatch(/offplug\s+1 skills.*\(disabled\)/);
    expect(pluginsSection).not.toMatch(/^\s+mkt\s/m);
  });
});
