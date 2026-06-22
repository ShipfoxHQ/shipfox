import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export type {ClaimedJob, EnqueueJobParams} from './jobs.js';
export {
  claimPendingJob,
  enqueueJob,
  expireStuckJobs,
  recordHeartbeat,
  releaseJob,
} from './jobs.js';
export type {CreateRunnerTokenParams} from './runner-tokens.js';
export {
  createRunnerToken,
  listUsableRunnerTokensByWorkspaceId,
  resolveRunnerTokenByHash,
  revokeRunnerToken,
} from './runner-tokens.js';
export {runnersOutbox} from './schema/outbox.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
