// Run with the Node version being tested and the Salesforce CLI's bin/run.js path.
// Uses temporary plugin configuration; does not authenticate or modify any org.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { generateKeyPairSync } = require('node:crypto');
const jwa = require('jwa');

const cli = process.argv[2];
assert(cli && fs.existsSync(cli), 'Pass the installed Salesforce CLI bin/run.js path');
const plugins = ['shane-sfdx-plugins', '@salesforce/analytics', '@mshanemc/sfdx-migration-automatic', 'sfdmu'];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-cli-runtime-'));
const project = path.resolve(__dirname, '..');
try {
    const data = path.join(root, 'data', 'sf');
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, 'package.json'), JSON.stringify({
        name: '@salesforce/cli', private: true,
        oclif: { schema: 1, plugins: plugins.map(name => ({ name, type: 'link', root: path.join(project, 'node_modules', name) })) }
    }));
    const env = { ...process.env,
        XDG_DATA_HOME: path.join(root, 'data'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'),
        SF_AUTOUPDATE_DISABLE: 'true', SF_LAZY_LOAD_MODULES: 'false',
        SF_DISABLE_LOG_FILE: 'true', SFDX_DISABLE_LOG_FILE: 'true',
        SF_DISABLE_TELEMETRY: 'true', SFDX_DISABLE_TELEMETRY: 'true'
    };
    const run = args => {
        const result = spawnSync(process.execPath, [path.resolve(cli), ...args], {
            cwd: project, env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 60000
        });
        assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.error || result.stderr || result.stdout}`);
        return result.stdout;
    };
    const version = run(['--version']).trim();
    assert(version.includes(`node-${process.version}`), 'CLI did not use the requested runtime');
    const commands = JSON.parse(run(['commands', '--json']));
    const checks = [
        'org:create:scratch', 'api:request:rest', 'shane:user:password:set',
        'analytics:app:list', 'automig:load', 'sfdmu:run'
    ];
    for (const id of checks) {
        assert(commands.some(command => command.id === id), `Missing command ${id}`);
        run([id, '--help']);
    }
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    for (const [algorithm, signingKey, verifyingKey] of [
        ['HS256', 'test-only-secret', 'test-only-secret'], ['RS256', privateKey, publicKey]
    ]) {
        const signer = jwa(algorithm);
        const signature = signer.sign('test.payload', signingKey);
        assert(signer.verify('test.payload', signature, verifyingKey));
        assert(!signer.verify('tampered.payload', signature, verifyingKey));
        assert(!signer.verify('test.payload', signature.slice(1), verifyingKey));
    }
    console.log(`${version}: command discovery, ${checks.length} command help checks, and JWT signature checks passed.`);
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
