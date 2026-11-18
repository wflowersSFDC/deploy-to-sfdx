import { execFile } from 'child_process';
import { promisify } from 'util';

const execute = promisify(execFile);

/** Argument arrays bypass the shell. Never log raw org-display responses or command arguments. */
export const runSalesforce = async (args: string[], cwd: string): Promise<any> => {
    let stdout: string;
    try {
        const result = await execute('sf', [...args, '--json'], { cwd, maxBuffer: 10 * 1024 * 1024 });
        stdout = result.stdout;
    } catch (error) {
        let response;
        try { response = JSON.parse(String(error.stdout)); } catch (_) { /* Plain-text CLI startup failure. */ }
        throw new Error(response?.message || String(error.stderr || 'Salesforce CLI failed').trim());
    }
    let response;
    try { response = JSON.parse(stdout); } catch (_) { throw new Error('Salesforce CLI returned invalid JSON'); }
    if (!response || response.status !== 0) throw new Error(response?.message || 'Salesforce CLI command failed');
    return response.result;
};
