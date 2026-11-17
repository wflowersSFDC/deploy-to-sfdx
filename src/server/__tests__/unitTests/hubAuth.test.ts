import { buildJWTAuthCommand } from '../../lib/hubAuth';
import { processWrapper } from '../../lib/processWrapper';

describe('hub authentication', () => {
    const originalConsumerKey = processWrapper.CONSUMERKEY;
    const originalHubUsername = processWrapper.HUB_USERNAME;
    const originalLocalKeyPath = processWrapper.LOCAL_ONLY_KEY_PATH;

    beforeAll(() => {
        processWrapper.CONSUMERKEY = 'test-client-id';
        processWrapper.HUB_USERNAME = 'hub@example.com';
        processWrapper.LOCAL_ONLY_KEY_PATH = '/tmp/test-hub.key';
    });

    afterAll(() => {
        processWrapper.CONSUMERKEY = originalConsumerKey;
        processWrapper.HUB_USERNAME = originalHubUsername;
        processWrapper.LOCAL_ONLY_KEY_PATH = originalLocalKeyPath;
    });

    test('uses a JWT bearer grant without authorization-code or refresh-token credentials', async () => {
        await expect(buildJWTAuthCommand()).resolves.toBe(
            'sfdx force:auth:jwt:grant --clientid test-client-id --username hub@example.com --jwtkeyfile /tmp/test-hub.key'
        );
    });
});
