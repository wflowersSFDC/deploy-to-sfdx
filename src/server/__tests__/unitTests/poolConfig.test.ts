jest.mock('request-promise-native', () => jest.fn());
jest.mock('../../lib/platformmarketingAuth', () => ({ readAuthenticatedPoolConfig: jest.fn() }));
jest.mock('../../lib/processWrapper', () => ({
    processWrapper: { POOLCONFIG_URL: 'https://example.com/pools', SINGLE_REPO: undefined }
}));

import request from 'request-promise-native';
import { getPoolConfig } from '../../lib/namedUtilities';
import { processWrapper } from '../../lib/processWrapper';
import { readAuthenticatedPoolConfig } from '../../lib/platformmarketingAuth';

const fetchConfig = request as jest.MockedFunction<typeof request>;
const pool = { user: 'SFDC-Assets', repo: 'sfconnect', quantity: 2, lifeHours: 12 };

beforeEach(() => {
    fetchConfig.mockReset();
    processWrapper.POOLCONFIG_URL = 'https://example.com/pools';
    processWrapper.SINGLE_REPO = undefined;
    processWrapper.POOLCONFIG_AUTH = undefined;
    (readAuthenticatedPoolConfig as jest.Mock).mockReset();
});

test('preserves the Salesforce endpoint error without leaking the request object', async () => {
    fetchConfig.mockRejectedValue({
        statusCode: 500,
        error: JSON.stringify([{ errorCode: 'APEX_ERROR', message: "System.QueryException: No such column 'GitHub_Repo__c' on entity 'Demo__c'.\n\nClass.poolsRestApi.actualWork: line 19" }]),
        options: { headers: { Authorization: 'private-token' } }
    });
    await expect(getPoolConfig()).rejects.toThrow("Unable to load pool configuration from POOLCONFIG_URL (HTTP 500): APEX_ERROR: System.QueryException: No such column 'GitHub_Repo__c' on entity 'Demo__c'.");
});

test('reports non-JSON HTTP failures without returning an empty pool list', async () => {
    fetchConfig.mockRejectedValue({ statusCode: 503, error: '<html>Unavailable</html>' });
    await expect(getPoolConfig()).rejects.toThrow('(HTTP 503): Request failed');
});

test('reports timeouts', async () => {
    fetchConfig.mockRejectedValue({ cause: { code: 'ETIMEDOUT' } });
    await expect(getPoolConfig()).rejects.toThrow('ETIMEDOUT');
    expect(fetchConfig).toHaveBeenCalledWith({ uri: 'https://example.com/pools', timeout: 20000 });
});

test('rejects malformed and non-array JSON', async () => {
    fetchConfig.mockResolvedValueOnce('<html>Sign in</html>').mockResolvedValueOnce('{}');
    await expect(getPoolConfig()).rejects.toThrow('did not return valid JSON');
    await expect(getPoolConfig()).rejects.toThrow('must return a JSON array');
});

test('loads legacy and multi-repository configurations', async () => {
    const modern = { quantity: 1, lifeHours: 4, repos: [{ username: 'owner', repo: 'repo', branch: 'main' }] };
    fetchConfig.mockResolvedValue(JSON.stringify([pool, modern]));
    const result = await getPoolConfig();
    expect(result[0]).toEqual({ quantity: 2, lifeHours: 12, repos: [{ username: 'sfdc-assets', repo: 'sfconnect', source: 'github', whitelisted: true }] });
    expect(result[1]).toEqual(modern);
});

test('single-repository mode matches owner/repo rather than repo/owner or a substring', async () => {
    processWrapper.SINGLE_REPO = 'https://github.com/SFDC-Assets/sfconnect/tree/master';
    fetchConfig.mockResolvedValue(JSON.stringify([pool, { ...pool, repo: 'sfconnect-other' }, { ...pool, user: 'other' }]));
    const result = await getPoolConfig();
    expect(result).toHaveLength(1);
    expect(result[0].repos[0].repo).toBe('sfconnect');
});

test('disabled pooling performs no request', async () => {
    processWrapper.POOLCONFIG_URL = undefined;
    await expect(getPoolConfig()).resolves.toEqual([]);
    expect(fetchConfig).not.toHaveBeenCalled();
});

test('JWT mode uses authenticated pool data and never sends an anonymous request', async () => {
    processWrapper.POOLCONFIG_AUTH = 'jwt';
    (readAuthenticatedPoolConfig as jest.Mock).mockResolvedValue(JSON.stringify([pool]));
    expect(await getPoolConfig()).toHaveLength(1);
    expect(readAuthenticatedPoolConfig).toHaveBeenCalledWith(processWrapper.POOLCONFIG_URL);
    expect(fetchConfig).not.toHaveBeenCalled();
});

test('JWT failure never falls back to anonymous', async () => {
    processWrapper.POOLCONFIG_AUTH = 'jwt';
    (readAuthenticatedPoolConfig as jest.Mock).mockRejectedValue(new Error('Authentication failed'));
    await expect(getPoolConfig()).rejects.toThrow('Authentication failed');
    expect(fetchConfig).not.toHaveBeenCalled();
});

test('invalid authentication modes fail closed', async () => {
    processWrapper.POOLCONFIG_AUTH = 'jtw';
    await expect(getPoolConfig()).rejects.toThrow('POOLCONFIG_AUTH must be');
    expect(fetchConfig).not.toHaveBeenCalled();
});
