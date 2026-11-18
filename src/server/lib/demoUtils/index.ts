import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { retry } from '@lifeomic/attempt';
import { parseDemoCommand } from './command';
import { Counter, generateUsername } from './username';
import { runSalesforce } from './salesforce';

export interface DemoContext { cwd: string; hubUsername?: string; targetOrg?: string; counter: Counter; }
type Run = typeof runSalesforce;

const text = (flags: Record<string, string | boolean>, name: string, fallback?: string): string =>
    typeof flags[name] === 'string' ? flags[name] as string : fallback;
const integer = (value: string, name: string, min: number, max: number): number => {
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`Invalid --${name}`);
    return Number(value);
};
const soql = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const xml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Real paths also prevent symlinks from escaping the deployment's checkout. */
const within = async (cwd: string, filename: string): Promise<string> => {
    const root = await fs.realpath(cwd);
    const target = await fs.realpath(path.resolve(root, filename));
    const relative = path.relative(root, target);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
        throw new Error('demoutil file paths must remain inside the deployment checkout');
    }
    return target;
};

const filesUnder = async (cwd: string, directory: string, suffix: string, recursive: boolean): Promise<string[]> => {
    const safeDirectory = await within(cwd, directory);
    const entries = await fs.readdir(safeDirectory);
    const files: string[] = [];
    for (const name of entries) {
        const filename = path.join(safeDirectory, name);
        const entry = await fs.lstat(filename);
        if (entry.isSymbolicLink()) throw new Error('demoutil metadata directories cannot contain symlinks');
        if (entry.isDirectory() && recursive) files.push(...await filesUnder(cwd, filename, suffix, true));
        if (entry.isFile() && name.endsWith(suffix)) files.push(await within(cwd, filename));
    }
    return files.sort();
};

export const executeDemoCommand = async (line: string, context: DemoContext, run: Run = runSalesforce): Promise<any> => {
    const { method, flags } = parseDemoCommand(line);
    const call = (args: string[]) => run(args, context.cwd);
    const target = context.targetOrg ? ['--target-org', context.targetOrg] : [];
    const singleRecord = async (query: string): Promise<any> => {
        const result = await retry(() => call(['data', 'query', '--query', query, ...target]), { maxAttempts: 5, delay: 1000, factor: 2 });
        if (result?.records?.length !== 1 || result.totalSize > 1) throw new Error('Expected exactly one matching Salesforce user');
        return result.records[0];
    };

    if (method === 'org create scratch') {
        if (!context.hubUsername) throw new Error('Dev Hub username is not configured');
        const definition = await within(context.cwd, text(flags, 'definitionfile', 'config/user.definition.json'));
        const duration = integer(text(flags, 'durationdays', '7'), 'durationdays', 1, 30);
        const wait = integer(text(flags, 'wait', '20'), 'wait', 2, 1440);
        const username = await generateUsername(context.counter, text(flags, 'userprefix', 'user'), text(flags, 'userdomain', 'example.com'));
        const args = ['org', 'create', 'scratch', '--definition-file', definition, '--duration-days', String(duration),
            '--wait', String(wait), '--username', username, '--set-default', '--target-dev-hub', context.hubUsername];
        if (flags.clientid) args.push('--client-id', text(flags, 'clientid'));
        if (flags.noancestors) args.push('--no-ancestors');
        if (flags.nonamespace) args.push('--no-namespace');
        // As in the existing deployer, repository-supplied aliases are not applied.
        const result = await call(args);
        if (!result?.orgId || !result?.username) throw new Error('Scratch-org creation returned no org ID or username');
        // CLI creation results may include authentication material; retain only the fields the app needs.
        return { status: 0, result: { orgId: result.orgId, username: result.username } };
    }

    if (method === 'user password set') {
        const password = text(flags, 'password');
        if (!password) throw new Error('demoutil user password set requires --password');
        const first = text(flags, 'firstname', 'User'), last = text(flags, 'lastname', 'User');
        const user = await singleRecord(`SELECT Id, Username FROM User WHERE LastName = '${soql(last)}' AND FirstName = '${soql(first)}' LIMIT 2`);
        if (!/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(user.Id)) throw new Error('Salesforce returned an invalid user ID');
        const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'deployer-password-'));
        try {
            const body = path.join(temp, 'body.json');
            await fs.writeFile(body, JSON.stringify({ NewPassword: password }), { mode: 0o600 });
            const response = await call(['api', 'request', 'rest', `/services/data/v61.0/sobjects/User/${user.Id}/password`,
                '--method', 'POST', '--header', 'Content-Type: application/json', '--body', `@${body}`, ...target]);
            if (!Number.isInteger(response?.statusCode) || response.statusCode < 200 || response.statusCode >= 300) {
                throw new Error(`Password update failed (HTTP ${response?.statusCode || 'unknown'})`);
            }
        } finally { await fs.remove(temp); }
        return { status: 0, result: { username: user.Username, password } };
    }

    const directory = text(flags, 'directory', 'force-app/main/default');
    let username: string, files: string[];
    if (method === 'agent userupdate') {
        const user = await singleRecord("SELECT Id, Username FROM User WHERE Profile.Name = 'Einstein Agent User' LIMIT 2");
        username = user.Username;
        files = await filesUnder(context.cwd, path.join(directory, 'bots'), '.bot-meta.xml', true);
    } else {
        username = context.targetOrg || (await call(['org', 'display', ...target]))?.username;
        files = await filesUnder(context.cwd, path.join(directory, 'transactionSecurityPolicies'), '.transactionSecurityPolicy-meta.xml', false);
    }
    if (!username) throw new Error('The deployment org has no username');
    if (!files.length) throw new Error(`No metadata files found for demoutil ${method}`);
    let updatedCount = 0;
    for (const filename of files) {
        const content = await fs.readFile(filename, 'utf8');
        let updated: string;
        if (method === 'agent userupdate') {
            if (!/<agentType>\s*EinsteinServiceAgent\s*<\/agentType>/.test(content)) continue;
            updated = content.replace(/<botUser>[\s\S]*?<\/botUser>/g, () => `<botUser>${xml(username)}</botUser>`);
        } else {
            updated = content.replace(/<(user|executionUser)>[\s\S]*?<\/\1>/g, (_, tag) => `<${tag}>${xml(username)}</${tag}>`);
        }
        if (updated !== content) { await fs.writeFile(filename, updated, 'utf8'); updatedCount++; }
    }
    return { status: 0, result: { message: `Updated ${updatedCount} metadata files.`, updatedCount } };
};
