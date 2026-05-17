import { execFile } from 'node:child_process';
const PLUGIN_NAME_RE = /^[a-zA-Z0-9_-]+$/;
function validateName(name) {
    if (!PLUGIN_NAME_RE.test(name)) {
        throw new Error(`Refusing to operate on suspicious plugin name: ${name}`);
    }
}
function runPluginCommand(subcommand, name) {
    return new Promise((resolve, reject) => {
        execFile('claude', ['plugin', subcommand, name], { timeout: 30000 }, (err, _stdout, stderr) => {
            if (err) {
                const detail = stderr?.trim() ? `: ${stderr.trim()}` : '';
                reject(new Error(`${err.message}${detail}`));
                return;
            }
            if (stderr?.trim()) {
                reject(new Error(stderr.trim()));
                return;
            }
            resolve();
        });
    });
}
/** Validates plugin name then shells out to `claude plugin disable <name>`. */
export async function disablePlugin(name) {
    validateName(name);
    return runPluginCommand('disable', name);
}
/** Validates plugin name then shells out to `claude plugin enable <name>`. */
export async function enablePlugin(name) {
    validateName(name);
    return runPluginCommand('enable', name);
}
