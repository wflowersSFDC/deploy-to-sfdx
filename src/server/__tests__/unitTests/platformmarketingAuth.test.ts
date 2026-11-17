jest.mock('request-promise-native', () => jest.fn());
jest.mock('../../lib/processWrapper', () => ({ processWrapper: {} }));

import { generateKeyPairSync, createVerify } from 'crypto';
import request from 'request-promise-native';
import { processWrapper } from '../../lib/processWrapper';
import { getPlatformmarketingToken, readAuthenticatedPoolConfig } from '../../lib/platformmarketingAuth';

const fetch = request as jest.MockedFunction<typeof request>;
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const origin = 'https://platformmarketing.my.salesforce.com';
const endpoint = `${origin}/services/apexrest/pools/Production`;
const token = { access_token: 'test-access-token', instance_url: origin };

beforeEach(() => {
    fetch.mockReset();
    processWrapper.PD_KEY = privateKey;
    processWrapper.PD_USERNAME = 'integration@example.com';
    processWrapper.PD_CONSUMERKEY = 'test-client-id';
});

test('signs a short-lived RS256 JWT with the platformmarketing identity', async () => {
    fetch.mockResolvedValue(token);
    await expect(getPlatformmarketingToken()).resolves.toEqual(token);
    const options = fetch.mock.calls[0][0] as any;
    const [header, payload, signature] = options.form.assertion.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString());
    expect(claims).toMatchObject({ iss: 'test-client-id', sub: 'integration@example.com', aud: 'https://login.salesforce.com' });
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(170);
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(180);
    expect(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(keys.publicKey, Buffer.from(signature, 'base64'))).toBe(true);
    expect(options).toMatchObject({ timeout: 20000, followRedirect: false, followAllRedirects: false });
});

test('reads pools with a bearer token only on the authenticated org', async () => {
    fetch.mockResolvedValueOnce(token).mockResolvedValueOnce('[]');
    await expect(readAuthenticatedPoolConfig(endpoint)).resolves.toBe('[]');
    expect(fetch.mock.calls[1][0]).toMatchObject({ uri: endpoint, headers: { Authorization: 'Bearer test-access-token' }, followRedirect: false, followAllRedirects: false });
});

test.each([
    'http://platformmarketing.my.salesforce.com/services/apexrest/pools/Production',
    'https://platformmarketing.my.salesforce-sites.com/pools/services/apexrest/pools/Production',
    'https://example.com/services/apexrest/pools/Production',
    'https://platformmarketing.my.salesforce.com/services/data/v66.0/query'
])('rejects an unsafe or incorrect endpoint: %s', async (url) => {
    await expect(readAuthenticatedPoolConfig(url)).rejects.toThrow('Authenticated POOLCONFIG_URL');
    expect(fetch).not.toHaveBeenCalled();
});

test('rejects another org without sending it the token', async () => {
    fetch.mockResolvedValue(token);
    await expect(readAuthenticatedPoolConfig('https://other.my.salesforce.com/services/apexrest/pools/Production')).rejects.toThrow('does not match');
    expect(fetch).toHaveBeenCalledTimes(1);
});

test('missing credentials fail before any network request', async () => {
    processWrapper.PD_KEY = undefined;
    await expect(getPlatformmarketingToken()).rejects.toThrow('requires PD_USERNAME');
    expect(fetch).not.toHaveBeenCalled();
});

test('authentication failure discards request secrets and does not fall back to anonymous', async () => {
    fetch.mockRejectedValue({ statusCode: 400, message: 'private assertion', options: { form: { assertion: 'private assertion' } } });
    await expect(readAuthenticatedPoolConfig(endpoint)).rejects.toEqual(new Error('Platformmarketing JWT authentication failed (HTTP 400)'));
    expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([302, 401, 403, 500])('HTTP %s does not follow redirects, retry anonymously, or expose the token', async (statusCode) => {
    fetch.mockResolvedValueOnce(token).mockRejectedValueOnce({ statusCode, options: { headers: { Authorization: 'Bearer test-access-token' } } });
    await expect(readAuthenticatedPoolConfig(endpoint)).rejects.toEqual(new Error(`Authenticated pool configuration request failed (HTTP ${statusCode})`));
    expect(fetch).toHaveBeenCalledTimes(2);
});
