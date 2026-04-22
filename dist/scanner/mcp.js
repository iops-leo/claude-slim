import { join } from 'node:path';
import { getClaudeDir } from '../paths.js';
import { safeReadFile } from './fs-walk.js';
export async function scanMcpServers() {
    const content = await safeReadFile(join(getClaudeDir(), 'settings.json'));
    if (!content)
        return { count: 0, names: [] };
    try {
        const data = JSON.parse(content);
        const servers = data.mcpServers || {};
        const names = Object.keys(servers).sort();
        return { count: names.length, names };
    }
    catch {
        return { count: 0, names: [] };
    }
}
