export type DemoMethod = 'org create scratch' | 'user password set' | 'tsp update' | 'agent userupdate';
export interface DemoCommand { method: DemoMethod; flags: Record<string, string | boolean>; }

export const isDemoCommand = (line: string): boolean => /^(sf|sfdx)\s+demoutil(?:\s|:|$)/.test(line.trim());

// Deliberately a command-argument parser, not a shell: no expansion or operators.
export const tokenize = (line: string): string[] => {
    const words: string[] = [];
    let word = '', quote = '', started = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
            if (c === quote) { quote = ''; continue; }
            if (c === '\\' && quote === '"' && ['"', '\\'].includes(line[i + 1])) { word += line[++i]; continue; }
            word += c;
        } else if (c === '"' || c === "'") {
            quote = c; started = true;
        } else if (/\s/.test(c)) {
            if (started) { words.push(word); word = ''; started = false; }
        } else {
            if (/[;&|<>`$()]/.test(c)) throw new Error('demoutil commands cannot contain shell operators or expansions');
            if (c === '\\') {
                if (++i >= line.length) throw new Error('Incomplete escape in demoutil command');
                word += line[i];
            } else { word += c; }
            started = true;
        }
    }
    if (quote) throw new Error('Unclosed quote in demoutil command');
    if (started) words.push(word);
    return words;
};

const specifications: Record<DemoMethod, Record<string, [string, boolean]>> = {
    'org create scratch': {
        p: ['userprefix', false], e: ['userdomain', false], f: ['definitionfile', false],
        d: ['durationdays', false], w: ['wait', false], i: ['clientid', false], a: ['setalias', false],
        c: ['noancestors', true], n: ['nonamespace', true], s: ['setdefaultusername', true]
    },
    'user password set': { g: ['firstname', false], l: ['lastname', false], p: ['password', false] },
    'tsp update': { d: ['directory', false] },
    'agent userupdate': { d: ['directory', false] }
};

export const parseDemoCommand = (line: string): DemoCommand => {
    const args = tokenize(line);
    if (!['sf', 'sfdx'].includes(args.shift())) throw new Error('Expected sf or sfdx');
    const topic = args.shift();
    if (topic?.startsWith('demoutil:')) args.unshift(...topic.split(':').slice(1));
    else if (topic !== 'demoutil') throw new Error('Expected demoutil');
    const words: string[] = [];
    while (args.length && !args[0].startsWith('-')) words.push(args.shift());
    const method = words.join(' ') as DemoMethod;
    if (!Object.prototype.hasOwnProperty.call(specifications, method)) throw new Error(`Unsupported built-in demoutil command: ${method}`);
    const spec = specifications[method];
    const flags: Record<string, string | boolean> = {};
    while (args.length) {
        const arg = args.shift();
        const match = /^--?([a-z][a-z-]*)(?:=(.*))?$/.exec(arg);
        if (!match) throw new Error(`Invalid argument for demoutil ${method}`);
        const name = match[1];
        const entry: [string, boolean] = name === 'json' ? ['json', true] : spec[name] || Object.values(spec).find(([long]) => long === name);
        if (!entry) throw new Error(`Unsupported flag --${name} for demoutil ${method}`);
        const [key, boolean] = entry;
        if (Object.prototype.hasOwnProperty.call(flags, key)) throw new Error(`Duplicate flag --${key}`);
        if (boolean) {
            if (match[2] !== undefined) throw new Error(`--${key} does not take a value`);
            flags[key] = true;
        } else {
            const value = match[2] === undefined ? args.shift() : match[2];
            if (!value || (match[2] === undefined && value.startsWith('-'))) throw new Error(`Missing value for --${key}`);
            flags[key] = value;
        }
    }
    return { method, flags };
};
