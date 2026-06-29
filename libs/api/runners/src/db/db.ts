import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {ephemeralRegistrationTokens} from './schema/ephemeral-registration-tokens.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobs} from './schema/pending-jobs.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';
import {reservations} from './schema/reservations.js';
import {resources} from './schema/resources.js';
import {runnerSessions} from './schema/runner-sessions.js';
import {runnerTokens} from './schema/runner-tokens.js';
import {runningJobs} from './schema/running-jobs.js';

export const schema = {
  ephemeralRegistrationTokens,
  pendingJobs,
  provisionerTokens,
  reservations,
  resources,
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

export type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];
