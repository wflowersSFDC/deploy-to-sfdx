/* eslint-disable no-process-exit */
import { utilities } from '../lib/utilities';
import { getPoolDeployRequestQueueSize } from '../lib/redisNormal';
import { startPoolDeployers } from '../lib/poolPrep';
import { prepareAll } from '../lib/poolPrep';
import logger from 'heroku-logger';

(async () => {
    if (utilities.checkHerokuAPI()) {
        await Promise.all([
            // kick off builders to deal with existing queue, if any
            startPoolDeployers(await getPoolDeployRequestQueueSize()),
            // put all the messages on the queue
            prepareAll()
        ]);
        // kick off more builders to deal with anything you just added to the queue
        await startPoolDeployers(await getPoolDeployRequestQueueSize());
    }
    process.exit(0);
})().catch((err) => {
    logger.error('Pool maintenance failed', { errorMessage: err.message });
    process.exit(1);
});
