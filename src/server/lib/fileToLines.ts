import logger from 'heroku-logger';
import * as readline from 'readline';
import * as fs from 'fs-extra';
import { commandRewriter, getCommandsWithFileFlagsMap } from '../lib/flagTypeFromCommandHelp';
import { isDemoCommand } from './demoUtils/command';

const fileToLines = (filePath: string): Promise<string[]> => {
    let parsedLines = [];
    return new Promise((resolve, reject) => {
        const input = fs.createReadStream(filePath);
        input.on('error', reject);
        readline
            .createInterface({
                input,
                terminal: false
            })
            .on('line', (line: string) => {
                line = line.trim();
                if (
                    (!line && line.length === 0) ||
                    line.startsWith('#!/bin/bash') ||
                    line.startsWith('#')
                ) {
                    return; // just ignore the meaningless stuff;
                }
                parsedLines.push(line);
            })
            .on('close', async () => {
                try {
                    // you have all the parsed lines
                    // normal tmp/deployid/orgInit.sh.  multirepo: tmp/deployid/repo/orgInit.sh
                    if (filePath.split('/').length > 3) {
                        // translate to base command, and if necessary, prepand the filepath to certain flag arguments
                        const commandMap = parsedLines.some((line) => !isDemoCommand(line))
                            ? await getCommandsWithFileFlagsMap() : [];
                        parsedLines = await Promise.all(
                            parsedLines.map((line) =>
                                commandRewriter(filePath.split('/')[2], line, commandMap)
                            )
                        );
                    }
                    logger.debug(`fileToLines: Read ${parsedLines.length} commands from ${filePath}`);
                    resolve(parsedLines.filter((line) => line !== ''));
                } catch (error) { reject(error); }
            });
    });
};

const filesToLines = async (filePaths: string[]): Promise<string[]> =>
    [].concat(...(await Promise.all(filePaths.map((filePath) => fileToLines(filePath)))));

export { fileToLines, filesToLines };
