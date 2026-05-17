import { runCommand } from './fs-walk.js';
export function parseDisabledPlugins(output) {
    const disabled = new Set();
    if (!output)
        return disabled;
    let currentName = null;
    for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('❯')) {
            const full = trimmed.split('❯')[1]?.trim() || '';
            // Format: sub-plugin@marketplace — extract marketplace name for cache dir matching
            currentName = full.includes('@') ? full.split('@')[1] : full;
        }
        else if (trimmed.toLowerCase().includes('disabled') && currentName) {
            disabled.add(currentName);
            currentName = null;
        }
        else if (trimmed.toLowerCase().includes('enabled')) {
            currentName = null;
        }
    }
    return disabled;
}
export async function getDisabledPlugins() {
    return parseDisabledPlugins(await runCommand('claude', ['plugin', 'list']));
}
// Parse `claude plugin list` output into per-plugin entries. Unlike
// parseDisabledPlugins (which collapses to marketplace name for cache-dir
// matching), this preserves the full <plugin>@<marketplace> pair so callers
// can match against plugin surface scanning by exact plugin name.
export function parseInstalledPlugins(output) {
    const plugins = [];
    if (!output)
        return plugins;
    let current = null;
    for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('❯')) {
            const full = trimmed.split('❯')[1]?.trim() || '';
            const at = full.indexOf('@');
            if (at > 0) {
                current = { name: full.slice(0, at), marketplace: full.slice(at + 1) };
            }
            else if (full) {
                current = { name: full, marketplace: full };
            }
            else {
                current = null;
            }
        }
        else if (current && trimmed.toLowerCase().includes('disabled')) {
            plugins.push({ ...current, enabled: false });
            current = null;
        }
        else if (current && trimmed.toLowerCase().includes('enabled')) {
            plugins.push({ ...current, enabled: true });
            current = null;
        }
    }
    return plugins;
}
export async function getInstalledPlugins() {
    return parseInstalledPlugins(await runCommand('claude', ['plugin', 'list']));
}
