/* eslint-disable @typescript-eslint/no-explicit-any */
import logger from 'heroku-logger';
import { exec, ExecOptions } from 'child_process';
import stripColor from 'strip-color';
import * as util from 'util';

const execProm = util.promisify(exec);
const maxBuffer = 1024 * 3000;

// tslint:disable-next-line: no-any
const exec2JSON = async (cmd: string, options?: ExecOptions): Promise<any> => {
    const fakeResults = {
        'status': 0,
        'results': 'Successfully loaded data'
    };

    try {
        if (cmd.includes('sfdx automig:load') || cmd.includes('sf automig load') || cmd.includes('sf data upsert') || cmd.includes('sfdx force:data:bulk:upsert')) {
            await execProm(cmd, { stdio: 'ignore', ...options });
            return fakeResults;
        } else {
            const results = await execProm(cmd, { maxBuffer, ...options });
            return JSON.parse(JSON.stringify(stripColor(results.stdout.toString())));
        }
    } catch (err) {
        console.log(err);
        return JSON.parse(stripColor(err.stdout));
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
