// serves as a shared build path for pool and non-pool orgs
import fs from 'fs-extra';
import logger from 'heroku-logger';

import { DeployRequest } from './types';
import { cdsPublish, putHerokuCDS } from './redisNormal';
import { lineRunner } from './lines';
import { timesToGA } from './timeTracking';
// import { poolParse } from './poolParse';
import { getCloneCommands, isByoo } from './namedUtilities';
import { CDS } from './CDS';
import { prepOrgInit, prepProjectScratchDef, prepareRepo } from './prepLocalRepo';

const build = async (msgJSON: DeployRequest): Promise<CDS> => {
    let clientResult = new CDS({
        deployId: msgJSON.deployId,
        browserStartTime: msgJSON.createdTimestamp,
        currentCommand: getCloneCommands(msgJSON)[0],
        isPool: msgJSON.pool,
        // isByoo: msgJSON.byoo && typeof msgJSON.byoo.accessToken === 'string'
        isByoo: isByoo(msgJSON)
    });

    // get something to redis as soon as possible
    await Promise.all([fs.ensureDir('tmp'), cdsPublish(clientResult)]);

    // clone the repo
    clientResult = await prepareRepo(msgJSON, clientResult);
    await cdsPublish(clientResult);
    if (clientResult.errors.length > 0) {
        return clientResult;
    }

    // figure out the org init file and optionally set the email
    await Promise.all([prepOrgInit(msgJSON), prepProjectScratchDef(msgJSON)]);
    try {
        clientResult = await lineRunner(msgJSON, clientResult);
    } catch (e) {
        const errorMessage = e.message || String(e);
        logger.error('deployQueueCheck: Deployment error', { deployId: msgJSON.deployId, errorMessage });
        clientResult.errors.push({ command: clientResult.currentCommand || 'deployment', error: errorMessage, raw: '' });
        clientResult.complete = true;
        clientResult.completeTimestamp = new Date();
        clientResult.currentCommand = undefined;
        await cdsPublish(clientResult);
    }

    await Promise.all([timesToGA(msgJSON, clientResult), fs.remove(`tmp/${msgJSON.deployId}`), putHerokuCDS(clientResult)]);

    return clientResult;
};

export { build };
