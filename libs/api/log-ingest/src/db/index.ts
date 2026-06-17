import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {accrueStoredBytes, claimCap, ensureJobAccounting, isJobCapped} from './accounting.js';
export {insertChunk} from './chunks.js';
export {closeDb, type Database, db, schema, type Transaction} from './db.js';
export {logIngestOutbox} from './schema/outbox.js';
export {
  type CasResult,
  casExtendCommittedLength,
  getAttemptStream,
  getOrCreateAttemptStream,
  setDeclaredTotalBytes,
} from './streams.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
