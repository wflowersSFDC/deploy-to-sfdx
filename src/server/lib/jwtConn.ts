// /ht: https://gist.github.com/jeffdonthemic/de5432f3e308882484f2acea68ebfabd

import jsforce from 'jsforce';
import { getPlatformmarketingToken } from './platformmarketingAuth';

// create the connection to the org
const jwtConn = async () => {
    const response = await getPlatformmarketingToken();

    const conn = new jsforce.Connection({
        accessToken: response.access_token,
        instanceUrl: response.instance_url
    });

    console.log(`Successfully connected to Org`, conn.version);
    return conn;
};

export { jwtConn };
