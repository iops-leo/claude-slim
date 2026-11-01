import { describe, it, expect } from 'vitest';
import { slugifyProjectPath, getCurrentProjectSlug } from '../paths.js';

/**
 * Claude Code names `~/.claude/projects/<slug>/` by replacing every character
 * outside [A-Za-z0-9] with `-`. Replacing only `/` (the pre-2.15.1 behaviour)
 * never matched on Windows, and missed POSIX paths containing `.`, `_` or a
 * space, so the current project's memory reported 0. Issue #20.
 *
 * Expected values are folder names Claude Code actually created on disk.
 */
describe('slugifyProjectPath', () => {
  it.each([
    // Windows, from issue #20
    ['C:\\Users\\Rob CPC\\code\\arctic-spas-workspace', 'C--Users-Rob-CPC-code-arctic-spas-workspace'],
    ['C:\\Users\\ROBCPC~1\\AppData\\Local\\Temp\\od-conn-test-4SnS2U', 'C--Users-ROBCPC-1-AppData-Local-Temp-od-conn-test-4SnS2U'],
    ['C:\\Program Files', 'C--Program-Files'],
    // macOS: underscore in a tmp dir
    ['/private/var/folders/r9/_y9b5ff9349fnpyh1cgtf7zm0000gn/T/tmplmxd3xc2', '-private-var-folders-r9--y9b5ff9349fnpyh1cgtf7zm0000gn-T-tmplmxd3xc2'],
    // POSIX: dot in a home dir (see HOME_PREFIX in report.ts)
    ['/Users/leo.new/foo', '-Users-leo-new-foo'],
    // unchanged: plain POSIX
    ['/Users/me/app', '-Users-me-app'],
  ])('%s → %s', (input, expected) => {
    expect(slugifyProjectPath(input)).toBe(expected);
  });
});

describe('getCurrentProjectSlug', () => {
  it('resolves before slugifying', () => {
    expect(getCurrentProjectSlug('/Users/me/my_app/../my_app')).toBe('-Users-me-my-app');
  });
});
