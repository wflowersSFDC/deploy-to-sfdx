import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { executeDemoCommand } from '../../lib/demoUtils';
import { isDemoCommand, parseDemoCommand } from '../../lib/demoUtils/command';
import { generateUsername } from '../../lib/demoUtils/username';
import { commandRewriter } from '../../lib/flagTypeFromCommandHelp';
import { jsonify, securityAssertions, multiOrgCorrections, byooFilter } from '../../lib/lineParse';

let cwd: string;
let run: jest.Mock;
let counter: { incr: jest.Mock };
const targetOrg = 'admin@example.com';
const context = () => ({ cwd, targetOrg, hubUsername: 'hub@example.com', counter });

beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'native-demo-test-'));
    run = jest.fn();
    counter = { incr: jest.fn().mockResolvedValue(1) };
});
afterEach(async () => { await fs.remove(cwd); });

test('parses legacy syntax, long flags, equals values, spaces, and literal punctuation', () => {
    expect(parseDemoCommand('sfdx demoutil:user:password:set -g "Jane Ann" --lastname=Smith -p \'a$tricky;password\' --json')).toEqual({
        method: 'user password set', flags: { firstname: 'Jane Ann', lastname: 'Smith', password: 'a$tricky;password', json: true }
    });
    expect(isDemoCommand('sf project deploy start')).toBe(false);
});

test.each([
    'sf demoutil org create scratch && echo injected',
    'sf demoutil org create scratch --target-dev-hub other',
    'sf demoutil user password set -p $(whoami)',
    'sf demoutil tsp update -d "unterminated',
    'sf demoutil unknown method',
    'sf demoutil tsp update --directory',
    'sf demoutil tsp update -d one -d two'
])('rejects unsafe or unsupported syntax: %s', (line) => {
    expect(() => parseDemoCommand(line)).toThrow();
});

test('creates scratch org through the stock CLI with a locally generated username', async () => {
    await fs.outputJson(path.join(cwd, 'config/project-scratch-def.json'), { edition: 'Developer' });
    run.mockResolvedValue({ orgId: '00D123', username: 'generated@example.com', authFields: { accessToken: 'secret' } });
    const result = await executeDemoCommand('sf demoutil org create scratch -f config/project-scratch-def.json -d 5 -s -w 60 -p admin -e sfconnect.demo -c -n -a ignored --json', context(), run);
    expect(result).toEqual({ status: 0, result: { orgId: '00D123', username: 'generated@example.com' } });
    const args = run.mock.calls[0][0];
    expect(args.slice(0, 3)).toEqual(['org', 'create', 'scratch']);
    expect(args).toEqual(expect.arrayContaining(['--duration-days', '5', '--wait', '60', '--target-dev-hub', 'hub@example.com', '--set-default', '--no-ancestors', '--no-namespace']));
    expect(args[args.indexOf('--username') + 1]).toMatch(/^admin[a-f0-9]{24}1@sfconnect\.demo$/);
    expect(args).not.toContain('ignored');
    expect(counter.incr).toHaveBeenCalledTimes(1);
});

test('does not claim success when scratch creation returns no org', async () => {
    await fs.outputJson(path.join(cwd, 'config/user.definition.json'), {});
    run.mockResolvedValue(undefined);
    await expect(executeDemoCommand('sf demoutil org create scratch', context(), run)).rejects.toThrow('no org ID');
});

test('uses an atomic namespaced sequence for concurrent username generation', async () => {
    let sequence = 0;
    counter.incr.mockImplementation(async () => ++sequence);
    const names = await Promise.all(Array.from({ length: 100 }, () => generateUsername(counter, 'admin', 'demo.example')));
    expect(new Set(names).size).toBe(100);
    expect(counter.incr.mock.calls.every(([key]) => /^usernameSequence:[a-f0-9]{64}$/.test(key))).toBe(true);
});

test.each([['bad prefix', 'example.com'], ['admin', 'invalid'], ['a'.repeat(60), 'example.com']])('rejects invalid username parts', async (prefix, domain) => {
    await expect(generateUsername(counter, prefix, domain)).rejects.toThrow();
    expect(counter.incr).not.toHaveBeenCalled();
});

test('sets a password without placing it on the command line and removes its temporary file', async () => {
    let bodyPath: string;
    run.mockImplementation(async (args) => {
        if (args[0] === 'data') return { totalSize: 1, records: [{ Id: '005000000000001AAA', Username: 'jane@example.com' }] };
        bodyPath = args[args.indexOf('--body') + 1].slice(1);
        expect(await fs.readJson(bodyPath)).toEqual({ NewPassword: 'a tricky;password' });
        expect((await fs.stat(bodyPath)).mode & 0o777).toBe(0o600);
        expect(args).not.toContain('a tricky;password');
        expect(args).toEqual(expect.arrayContaining(['--target-org', targetOrg, '--method', 'POST']));
        return { statusCode: 204, body: '' };
    });
    const result = await executeDemoCommand('sf demoutil user password set -g "Jane Ann" -l "O\'Neil" -p "a tricky;password"', context(), run);
    expect(run.mock.calls[0][0]).toContain("SELECT Id, Username FROM User WHERE LastName = 'O\\'Neil' AND FirstName = 'Jane Ann' LIMIT 2");
    expect(result.result).toEqual({ username: 'jane@example.com', password: 'a tricky;password' });
    expect(await fs.pathExists(bodyPath)).toBe(false);
});

test('rejects ambiguous user selection without setting any password', async () => {
    run.mockResolvedValue({ totalSize: 2, records: [{ Id: 'one' }, { Id: 'two' }] });
    await expect(executeDemoCommand('sf demoutil user password set -p secret', context(), run)).rejects.toThrow('exactly one');
    expect(run).toHaveBeenCalledTimes(1);
});

test('cleans up the password file and fails when the API rejects the update', async () => {
    let bodyPath: string;
    run.mockImplementation(async (args) => {
        if (args[0] === 'data') return { records: [{ Id: '005000000000001AAA', Username: targetOrg }] };
        bodyPath = args[args.indexOf('--body') + 1].slice(1);
        return { statusCode: 400, body: [{ message: 'Password policy' }] };
    });
    await expect(executeDemoCommand('sf demoutil user password set -p secret', context(), run)).rejects.toThrow('HTTP 400');
    expect(await fs.pathExists(bodyPath)).toBe(false);
});

test('rewrites native file arguments without plugin discovery and preserves quoted values', async () => {
    const line = await commandRewriter('repo', 'sf demoutil org create scratch -f "config/my definition.json"');
    expect(parseDemoCommand(line).flags.definitionfile).toBe('repo/config/my definition.json');
    expect(parseDemoCommand(await commandRewriter('repo', 'sf demoutil tsp update')).flags.directory)
        .toBe('repo/force-app/main/default');
    const password = `sf demoutil user password set -l "O'Neil" -p 'literal$; --json'`;
    expect(parseDemoCommand(jsonify(securityAssertions(await commandRewriter('repo', password)))).flags)
        .toEqual({ lastname: "O'Neil", password: 'literal$; --json', json: true });
});

test('multi-repo and BYOO handling recognizes native and legacy passwords without dropping following steps', () => {
    const first = 'sf demoutil user password set -p one';
    const next = 'sf project deploy start';
    expect(multiOrgCorrections([first, next, 'sfdx demoutil:user:password:set -p two'])).toEqual([first, next]);
    expect(byooFilter(first)).toBe(false);
    expect(byooFilter('sf demoutil org create scratch')).toBe(false);
    expect(byooFilter('sf demoutil tsp update')).toBe(true);
});

test('updates both TSP user tags and waits for writes to finish', async () => {
    const file = path.join(cwd, 'force-app/main/default/transactionSecurityPolicies/Test.transactionSecurityPolicy-meta.xml');
    await fs.outputFile(file, '<Policy><user>old</user><executionUser>old</executionUser><enabled>true</enabled></Policy>');
    const result = await executeDemoCommand('sf demoutil tsp update', context(), run);
    expect(await fs.readFile(file, 'utf8')).toBe(`<Policy><user>${targetOrg}</user><executionUser>${targetOrg}</executionUser><enabled>true</enabled></Policy>`);
    expect(result.result.updatedCount).toBe(1);
});

test('updates service-agent bots recursively, escapes XML, and preserves other bot types', async () => {
    const root = path.join(cwd, 'force-app/main/default/bots');
    const bot = '<Bot><agentType>EinsteinServiceAgent</agentType><botUser>old</botUser></Bot>';
    await fs.outputFile(path.join(root, 'nested/Agent.bot-meta.xml'), bot);
    await fs.outputFile(path.join(root, 'Other.bot-meta.xml'), bot.replace('EinsteinServiceAgent', 'Other'));
    run.mockResolvedValue({ totalSize: 1, records: [{ Username: 'agent&test@example.com' }] });
    const result = await executeDemoCommand('sf demoutil agent userupdate', context(), run);
    expect(await fs.readFile(path.join(root, 'nested/Agent.bot-meta.xml'), 'utf8')).toContain('<botUser>agent&amp;test@example.com</botUser>');
    expect(await fs.readFile(path.join(root, 'Other.bot-meta.xml'), 'utf8')).toContain('<botUser>old</botUser>');
    expect(result.result.updatedCount).toBe(1);
});

test('rejects file paths and symlinks outside the checkout', async () => {
    await fs.symlink(os.tmpdir(), path.join(cwd, 'outside'));
    await expect(executeDemoCommand('sf demoutil org create scratch -f outside', context(), run)).rejects.toThrow('inside');
    expect(run).not.toHaveBeenCalled();
});
