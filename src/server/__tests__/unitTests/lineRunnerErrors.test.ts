jest.mock('../../lib/redisNormal', () => ({ cdsPublish: jest.fn().mockResolvedValue(undefined), deleteOrg: jest.fn() }));
jest.mock('../../lib/lineParse', () => ({ lineParse: jest.fn() }));
jest.mock('../../lib/execProm', () => ({ exec2JSON: jest.fn(), exec: jest.fn(), exec2String: jest.fn() }));
jest.mock('../../lib/processWrapper', () => ({ processWrapper: {} }));
jest.mock('../../lib/utilities', () => ({ utilities: {} }));
jest.mock('../../lib/loginURL', () => ({ loginURL: jest.fn() }));

import { lineRunner } from '../../lib/lines';
import { lineParse } from '../../lib/lineParse';
import { exec2JSON } from '../../lib/execProm';
import { cdsPublish } from '../../lib/redisNormal';
import { CDS } from '../../lib/CDS';

const command = 'sf demoutil org create scratch --json';
const message = { deployId: 'test-deployment', createdTimestamp: new Date(), repos: [{ username: 'owner', repo: 'repo' }] };

beforeEach(() => {
    jest.clearAllMocks();
    (lineParse as jest.Mock).mockResolvedValue([command, 'sf project deploy start --json']);
});

test.each([
    { status: 1, message: 'Scratch org limit reached' },
    { status: 0 },
])('stops after failed or incomplete scratch creation: %j', async (response) => {
    (exec2JSON as jest.Mock).mockResolvedValue(response);
    await expect(lineRunner(message, new CDS({ deployId: message.deployId }))).rejects.toThrow();
    expect(exec2JSON).toHaveBeenCalledTimes(1);
    const saved = (cdsPublish as jest.Mock).mock.calls.slice(-1)[0][0];
    expect(saved.complete).toBe(true);
    expect(saved.currentCommand).toBeUndefined();
    expect(saved.errors).toHaveLength(1);
    expect(saved.errors[0].error).not.toMatch(/JSON|stdout/);
});

test('a plain Error with no stdout is saved as a terminal failure', async () => {
    (exec2JSON as jest.Mock).mockRejectedValue(new Error('Cannot read properties of undefined (reading prototype)'));
    await expect(lineRunner(message, new CDS({ deployId: message.deployId }))).rejects.toThrow('prototype');
    const saved = (cdsPublish as jest.Mock).mock.calls.slice(-1)[0][0];
    expect(saved.complete).toBe(true);
    expect(saved.errors[0].error).toContain('prototype');
});
