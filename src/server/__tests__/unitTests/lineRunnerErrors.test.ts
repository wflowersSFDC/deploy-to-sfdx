jest.mock('../../lib/redisNormal', () => ({ cdsPublish: jest.fn().mockResolvedValue(undefined), deleteOrg: jest.fn() }));
jest.mock('../../lib/lineParse', () => ({ lineParse: jest.fn() }));
jest.mock('../../lib/execProm', () => ({ exec2JSON: jest.fn(), exec: jest.fn(), exec2String: jest.fn() }));
jest.mock('../../lib/processWrapper', () => ({ processWrapper: {} }));
jest.mock('../../lib/utilities', () => ({ utilities: {} }));
jest.mock('../../lib/loginURL', () => ({ loginURL: jest.fn() }));
jest.mock('../../lib/demoUtils', () => ({ executeDemoCommand: jest.fn() }));

import { lineRunner } from '../../lib/lines';
import { lineParse } from '../../lib/lineParse';
import { exec2JSON } from '../../lib/execProm';
import { cdsPublish } from '../../lib/redisNormal';
import { CDS } from '../../lib/CDS';
import { executeDemoCommand } from '../../lib/demoUtils';

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
    (executeDemoCommand as jest.Mock).mockResolvedValue(response);
    await expect(lineRunner(message, new CDS({ deployId: message.deployId }))).rejects.toThrow();
    expect(executeDemoCommand).toHaveBeenCalledTimes(1);
    expect(exec2JSON).not.toHaveBeenCalled();
    const saved = (cdsPublish as jest.Mock).mock.calls.slice(-1)[0][0];
    expect(saved.complete).toBe(true);
    expect(saved.currentCommand).toBeUndefined();
    expect(saved.errors).toHaveLength(1);
    expect(saved.errors[0].error).not.toMatch(/JSON|stdout/);
});

test('a plain Error with no stdout is saved as a terminal failure', async () => {
    (executeDemoCommand as jest.Mock).mockRejectedValue(new Error('Cannot read properties of undefined (reading prototype)'));
    await expect(lineRunner(message, new CDS({ deployId: message.deployId }))).rejects.toThrow('prototype');
    const saved = (cdsPublish as jest.Mock).mock.calls.slice(-1)[0][0];
    expect(saved.complete).toBe(true);
    expect(saved.errors[0].error).toContain('prototype');
});

test('routes native commands internally and retains the target org and pool open command', async () => {
    const password = 'sf demoutil user password set -p test-password --json';
    const open = 'sf org open -p /lightning/page/home --json -r';
    (lineParse as jest.Mock).mockResolvedValue([command, password, 'sf project deploy start --json', open]);
    (executeDemoCommand as jest.Mock)
        .mockResolvedValueOnce({ status: 0, result: { orgId: '00Dtest', username: 'test@example.com' } })
        .mockResolvedValueOnce({ status: 0, result: { username: 'test@example.com', password: 'test-password' } });
    (exec2JSON as jest.Mock).mockResolvedValue({ status: 0, result: { LoginUrl: 'https://example.com', ExpirationDate: '2026-11-19' } });
    const result = await lineRunner({ ...message, pool: true }, new CDS({ deployId: message.deployId }));
    expect(result.complete).toBe(true);
    expect(result.mainUser.username).toBe('test@example.com');
    expect(result.mainUser.password).toBe('test-password');
    expect(result.poolLines.openLine).toBe(open);
    expect(executeDemoCommand).toHaveBeenNthCalledWith(2, password, expect.objectContaining({ targetOrg: 'test@example.com' }));
    expect((exec2JSON as jest.Mock).mock.calls.some(([line]) => line.includes('demoutil') || line === open)).toBe(false);
});
