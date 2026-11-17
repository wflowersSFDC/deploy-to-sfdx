jest.mock('fs-extra', () => ({ ensureDir: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../lib/redisNormal', () => ({ cdsPublish: jest.fn().mockResolvedValue(undefined), putHerokuCDS: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../lib/lines', () => ({ lineRunner: jest.fn().mockRejectedValue(new Error('CLI startup failed')) }));
jest.mock('../../lib/timeTracking', () => ({ timesToGA: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../lib/prepLocalRepo', () => ({
    prepareRepo: jest.fn().mockImplementation(async (_, result) => result),
    prepOrgInit: jest.fn().mockResolvedValue(undefined), prepProjectScratchDef: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../lib/processWrapper', () => ({ processWrapper: {} }));

import { build } from '../../lib/commonBuild';
import { cdsPublish } from '../../lib/redisNormal';

test('a runner exception leaves a completed failure in the results store', async () => {
    const result = await build({ deployId: 'failed-deploy', createdTimestamp: new Date(), repos: [{ username: 'owner', repo: 'repo' }] });
    expect(result.complete).toBe(true);
    expect(result.currentCommand).toBeUndefined();
    expect(result.errors[0].error).toBe('CLI startup failed');
    expect(cdsPublish).toHaveBeenLastCalledWith(expect.objectContaining({ complete: true, currentCommand: undefined }));
});
