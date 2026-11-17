/* eslint-disable @typescript-eslint/no-explicit-any */
import logger from 'heroku-logger';
import { exec, ExecOptions } from 'child_process';
import stripColor from 'strip-color';
import * as util from 'util';

const execProm = util.promisify(exec);
const maxBuffer = 1024 * 100000;

// tslint:disable-next-line: no-any
const exec2JSON = async (cmd: string, options?: ExecOptions): Promise<any> => {
    let stdout: string;
    try {
        const results = await execProm(cmd, { maxBuffer, ...options });
        stdout = results.stdout.toString();
    } catch (err) {
        try {
            const result = JSON.parse(stripColor(String(err.stdout || '')));
            if (result && typeof result === 'object' && result.status !== 0) {
                return result;
            }
        } catch (_) {
            // CLI startup failures often write plain text to stderr, not JSON.
        }
        throw new Error(stripColor(String(err.stderr || err.message || 'Command failed')).trim());
    }
    try {
        return JSON.parse(stripColor(stdout));
    } catch (_) {
        throw new Error('Command completed without valid JSON output');
    }
};

// tslint:disable-next-line: no-any
const exec2String = async (cmd: string, options?: ExecOptions): Promise<any> => {
    try {
        const results = await execProm(cmd, { maxBuffer, ...options });
        logger.debug(`ojibowa results-- ${results.stdout}`);
        return results.stdout;
    } catch (err) {
        // console.log(err);
        return err.stdout;
    }
};

export { execProm, exec2JSON, exec2String };
export { execProm as exec };
