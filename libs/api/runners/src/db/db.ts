import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {capacityAssignments} from './schema/capacity-assignments.js';
import {ephemeralRegistrationTokens} from './schema/ephemeral-registration-tokens.js';
import {manualRegistrationTokens} from './schema/manual-registration-tokens.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobExecutions} from './schema/pending-job-executions.js';
import {provisionedRunners} from './schema/provisioned-runners.js';
import {provisionerCapabilitySnapshots} from './schema/provisioner-capability-snapshots.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';
import {runnersRateLimits} from './schema/rate-limits.js';
import {reservations} from './schema/reservations.js';
import {runnerSessions} from './schema/runner-sessions.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

export const schema = {
  capacityAssignments,
  ephemeralRegistrationTokens,
  pendingJobExecutions,
  provisionedRunners,
  provisionerCapabilitySnapshots,
  provisionerTokens,
  runnersRateLimits,
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
