import { createSign } from 'crypto';
import request from 'request-promise-native';
import { processWrapper } from './processWrapper';

const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/** Use the pool-drain integration identity, never the Dev Hub identity. */
export const getPlatformmarketingToken = async (): Promise<{ access_token: string; instance_url: string }> => {
    if (!processWrapper.PD_USERNAME || !processWrapper.PD_CONSUMERKEY || !processWrapper.PD_KEY) {
        throw new Error('Platformmarketing authentication requires PD_USERNAME, PD_CONSUMERKEY and PD_KEY');
    }
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
        iss: processWrapper.PD_CONSUMERKEY, sub: processWrapper.PD_USERNAME,
        aud: 'https://login.salesforce.com', exp: Math.floor(Date.now() / 1000) + 180
    })}`;
    let signature: string;
    try {
        signature = createSign('RSA-SHA256').update(unsigned).sign(processWrapper.PD_KEY, 'base64')
            .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    } catch (_) {
        throw new Error('PD_KEY is not a valid RSA private key');
    }
    let token;
    try {
        token = await request({
            method: 'POST', uri: 'https://login.salesforce.com/services/oauth2/token',
            form: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` },
            json: true, timeout: 20000, followRedirect: false, followAllRedirects: false
        });
    } catch (err) {
        // Request errors contain the signed assertion; never propagate those objects.
        throw new Error(`Platformmarketing JWT authentication failed${err.statusCode ? ` (HTTP ${err.statusCode})` : ''}`);
    }
    if (!token || typeof token.access_token !== 'string' || !token.access_token || typeof token.instance_url !== 'string') {
        throw new Error('Platformmarketing JWT authentication returned an invalid token response');
    }
    const instance = new URL(token.instance_url);
    if (instance.protocol !== 'https:' || !instance.hostname.endsWith('.salesforce.com') || instance.username || instance.password || instance.port) {
        throw new Error('Platformmarketing JWT authentication returned an invalid Salesforce instance URL');
    }
    return { access_token: token.access_token, instance_url: instance.origin };
};

/** Do not send org tokens to public Sites, other hosts, or redirect destinations. */
export const readAuthenticatedPoolConfig = async (url: string): Promise<string> => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password || target.port ||
        !target.hostname.endsWith('.salesforce.com') || !target.pathname.startsWith('/services/apexrest/pools/')) {
        throw new Error('Authenticated POOLCONFIG_URL must be an HTTPS Salesforce org URL under /services/apexrest/pools/');
    }
    const token = await getPlatformmarketingToken();
    if (target.origin !== token.instance_url) {
        throw new Error('POOLCONFIG_URL does not match the org authenticated by the platformmarketing credentials');
    }
    try {
        return await request({ uri: target.href, headers: { Authorization: `Bearer ${token.access_token}` },
            timeout: 20000, followRedirect: false, followAllRedirects: false });
    } catch (err) {
        // Discard the request object, including its Authorization header.
        throw new Error(`Authenticated pool configuration request failed${err.statusCode ? ` (HTTP ${err.statusCode})` : ''}`);
    }
};
