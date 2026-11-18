/* eslint-disable no-await-in-loop */
import * as fs from 'fs-extra';

// import logger from 'heroku-logger';

import { shellSanitize } from './shellSanitize';
import { argStripper } from './argStripper';
import { DeployRequest } from './types';
import { isMultiRepo, isByoo, getPackageDirsFromFile, getArg } from './namedUtilities';
import { filesToLines } from './fileToLines';
import { isDemoCommand, parseDemoCommand } from './demoUtils/command';

const jsonify = (line: string): string => {
    if (isDemoCommand(line)) return parseDemoCommand(line).flags.json ? line : `${line} --json`;
    if (line.startsWith('sfdx ') || line.startsWith('sf ')) {
        // TODO: handling for & at the end of line for background runs
        return `${argStripper(line, '--json', true)} --json`;
    } else {
        return line;
    }
};

const byooFilter = (line: string): boolean => {
    if (line.includes('org:create') || line.includes('org create')) {
        return false;
    }
    if (line.includes('user:password') || line.includes('user password')) {
        return false;
    }
    return true;
};

const securityAssertions = (line: string): string => {    
    if (isDemoCommand(line)) {
        parseDemoCommand(line); // Arguments are parsed and dispatched internally, never interpreted by a shell.
        return line;
    }
    if (!shellSanitize(line)) {
        throw new Error(
            `ERROR: Commands with metacharacters cannot be executed.  Put each command on a separate line.  Your command: ${line}`
        );
    }

    if (!(line.startsWith('sfdx ') || line.startsWith('sf '))) {
        throw new Error(
            `ERROR: Commands must start with sfdx, sf or be comments (security, yo!).  Your command: ${line}`
        );
    }
    if (line.includes(' -u ') || line.includes(' --targetusername ')) {
        throw new Error(
            `ERROR: Commands can't contain -u...you can only execute commands against the default project the deployer creates--this is a multitenant sfdx deployer.  Your command: ${line}`
        );
    }

    if (line.includes('plugins')) {
        throw new Error(
            `ERROR: You can't install your own plugins. Your command: ${line}`
        );
    }

    if (line.includes('list') || line.includes('display')) {
        throw new Error(
            `ERROR: You can't list or display our orgs, shapes or snapshots. Your command: ${line}`
        );
    }

    const shaneRegex = /file\s+upload/;
    const standardRegex = /create\s+file/;

    if (line.includes('file:upload') || line.includes('create:file') || shaneRegex.test(line) || standardRegex.test(line) ) {
        throw new Error(
            `ERROR: You can't upload files. Your command: ${line}`
        );
    }

    return line;
};

// corrections and improvements for individual commands, always runs
const lineCorrections = (line: string, msgJSON: DeployRequest): string => {
    if (isDemoCommand(line)) {
        parseDemoCommand(line);
        return line;
    }
    // we ALWAYS want -r instead of real open on our server
    if ((line.includes('sfdx force:org:open') || line.includes('sf org open')) && !line.includes(' -r')) {
        return `${line} -r`;
    }
    if (line.includes(':org:create') || line.includes('org create')) {
        // console.log(`line reached corrections for create:  it is ${line}`);
        // handle the shane plugin and the stock commmand
        // no aliases allowed to keep the deployer from getting confused between deployments
        line = argStripper(line, '--setalias');
        line = argStripper(line, '-a');
        // no hub changes allowed
        line = argStripper(line, '--targetdevhubusername');
        line = argStripper(line, '-v');
        return line;
    }
    if (isByoo(msgJSON) && (line.includes('sfdx force:user:permset:assign') || line.includes('sf org assign permset'))) {
        // the username on byoo deploys is a accesstoken, which confuses the standard permset assign command
        return line.replace('force:user', 'shane:user');
    }
    // if (line.includes('sfdx automig:load') || line.includes('sf automig load')) {
    //     // if the script didn't supply the concise line, make sure it's there.
    //     return `${argStripper(line, '--concise', true)} --concise`;
    // }
    if (isByoo(msgJSON) && (line.includes('sfdx force:source:push') || line.includes('sf project deploy start'))) {
        const project = fs.readJSONSync(`tmp/${msgJSON.deployId}/sfdx-project.json`);
        // byoo might not be a scratch org, so we'll deploy it using deploy instead of push, referencing the project directories
        return line.replace(
            'sfdx force:source:push',
            `sfdx force:source:deploy -p ${getPackageDirsFromFile(project)}`
        );
    }

    if (isByoo(msgJSON) && line.includes('sf project deploy start')) {
        const project = fs.readJSONSync(`tmp/${msgJSON.deployId}/sfdx-project.json`);
        // byoo might not be a scratch org, so we'll deploy it using deploy instead of push, referencing the project directories
        return line.replace(
            'sf project deploy start',
            `sfdx force:source:deploy -p ${getPackageDirsFromFile(project)}`
        );
    }

    return line;
};

const multiOrgCorrections = (lines: string[]): string[] => {
    let passwordSeen = false;
    return lines.filter((line) => {
        const password = isDemoCommand(line) ? parseDemoCommand(line).method === 'user password set' :
            /user(?::|\s+)password/.test(line);
        if (!password) return true;
        if (passwordSeen) return false;
        passwordSeen = true;
        return true;
    });
};
const getMaxDays = (lines: string[]): number =>
    Math.max(
        ...lines
            .filter((line) => (line.includes('org:create') || line.includes('org create')))
            .map(
                (line) =>
                    isDemoCommand(line) ? Number(parseDemoCommand(line).flags.durationdays || 7) :
                    parseInt(getArg(line, '-y'), 10) || parseInt(getArg(line, '--duration-days'), 10) ||
                    parseInt(getArg(line, '-d'), 10) || parseInt(getArg(line, '--days'), 10) || 7
            )
    );

const lineParse = async (msgJSON: DeployRequest): Promise<string[]> => {
    let parsedLines = (
        await filesToLines(
            msgJSON.repos.map((repo) =>
                isMultiRepo(msgJSON)
                    ? `tmp/${msgJSON.deployId}/${repo.repo}/orgInit.sh`
                    : `tmp/${msgJSON.deployId}/orgInit.sh`
            )
        )
    )
        .map((line) =>
            msgJSON.repos.every((repo) => repo.whitelisted) ? line : securityAssertions(line)
        )
        .filter((line) => !isByoo(msgJSON) || byooFilter(line)) // let through if !byoo, and filter out create/password commands
        .map((line) => lineCorrections(line, msgJSON))
        .map((line) => jsonify(line));

    if (isByoo(msgJSON)) {
        // special auth scenario for byoo user
        parsedLines.unshift(
            `sf config set defaultdevhubusername= defaultusername='${msgJSON.byoo.accessToken}' instanceUrl='${msgJSON.byoo.instanceUrl}' --json`
        );
    }

    if (!isByoo(msgJSON) && isMultiRepo(msgJSON)) {
        // remove all the creates and put it at the beginning
        parsedLines = [
            `sf demoutil org create scratch -f config/project-scratch-def.json -d ${getMaxDays(
                parsedLines
            )} -s --json`,
            ...parsedLines.filter((line) => !line.includes('org create') && !line.includes('org:create'))
        ];
    }

    if (isMultiRepo(msgJSON)) {
        parsedLines = multiOrgCorrections(parsedLines);
    }

    return parsedLines;
};

export { lineParse, jsonify, securityAssertions, byooFilter, getMaxDays, multiOrgCorrections };
