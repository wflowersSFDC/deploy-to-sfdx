import Redis from 'ioredis';
import { processWrapper } from './processWrapper';

const redisURL = processWrapper.REDIS_TLS_URL || processWrapper.REDIS_URL || "redis://localhost:6379"
let redisOpts = {}
if (redisURL.startsWith("rediss://")) {
    redisOpts = {
        tls: {
            rejectUnauthorized: false,
            requestCert: true
        }
    }
}
const redis = new Redis(redisURL, redisOpts);
export = redis;
