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
