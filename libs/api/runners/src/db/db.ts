import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {ephemeralRegistrationTokens} from './schema/ephemeral-registration-tokens.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobs} from './schema/pending-jobs.js';
import {reservations} from './schema/reservations.js';
import {runnerSessions} from './schema/runner-sessions.js';
import {runnerTokens} from './schema/runner-tokens.js';
import {runningJobs} from './schema/running-jobs.js';

export const schema = {
  ephemeralRegistrationTokens,
  pendingJobs,
  reservations,
  runnerSessions,
  runnerTokens,
  runningJobs,
  runnersOutbox,
};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
