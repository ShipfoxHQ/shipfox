import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {ephemeralRegistrationTokens} from './schema/ephemeral-registration-tokens.js';
import {manualRegistrationTokens} from './schema/manual-registration-tokens.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobExecutions} from './schema/pending-job-executions.js';
import {provisionedRunners} from './schema/provisioned-runners.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';
import {reservations} from './schema/reservations.js';
import {runnerSessions} from './schema/runner-sessions.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

export const schema = {
  ephemeralRegistrationTokens,
  pendingJobExecutions,
  provisionedRunners,
  provisionerTokens,
  reservations,
  runnerSessions,
  manualRegistrationTokens,
  runningJobExecutions,
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
