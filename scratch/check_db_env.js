import { getConfig } from '../src/config.js';
import process from 'node:process';

const config = getConfig();
console.log('DATABASE_URL present:', Boolean(process.env.DATABASE_URL || process.env.DIRECT_URL || process.env.POSTGRES_URL));
console.log('DATABASE_URL value length:', (process.env.DATABASE_URL || process.env.DIRECT_URL || '').length);
