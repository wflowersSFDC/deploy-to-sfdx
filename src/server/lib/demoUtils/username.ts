import { createHash, randomBytes } from 'crypto';

export interface Counter { incr(key: string): Promise<number>; }

/** Randomness avoids reuse after a Redis restore; INCR coordinates concurrent workers. */
export const generateUsername = async (counter: Counter, prefix = 'user', domain = 'example.com'): Promise<string> => {
    if (!/^[a-z0-9._+-]+$/i.test(prefix) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain) || domain.includes('..')) {
        throw new Error('Username prefix or domain is invalid');
    }
    if (prefix.length + domain.length + 26 > 80) throw new Error('Username prefix and domain are too long');
    const key = `usernameSequence:${createHash('sha256').update(`${prefix.toLowerCase()}/${domain.toLowerCase()}`).digest('hex')}`;
    const sequence = await counter.incr(key);
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Username sequence is invalid');
    const username = `${prefix}${randomBytes(12).toString('hex')}${sequence}@${domain}`.toLowerCase();
    if (username.length > 80) throw new Error('Generated username exceeds Salesforce’s 80-character limit');
    return username;
};
