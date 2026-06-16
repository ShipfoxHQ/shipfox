import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {attemptStreams} from './schema/attempt-streams.js';
import {logChunks} from './schema/chunks.js';
import {jobAccounting} from './schema/job-accounting.js';
import {logIngestOutbox} from './schema/outbox.js';

export const schema = {jobAccounting, attemptStreams, logChunks, logIngestOutbox};

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

let _db: Database | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
