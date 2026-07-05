import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {triggersCronSchedules} from './schema/cron-schedules.js';
import {triggersDecisions} from './schema/decisions.js';
import {jobListenerSubscriptions} from './schema/job-listener-subscriptions.js';
import {triggersOutbox} from './schema/outbox.js';
import {triggersReceivedEvents} from './schema/received-events.js';
import {triggerSubscriptions} from './schema/subscriptions.js';

export const schema = {
  triggersCronSchedules,
  jobListenerSubscriptions,
  triggerSubscriptions,
  triggersOutbox,
  triggersReceivedEvents,
  triggersDecisions,
};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];
export type Executor = ReturnType<typeof db> | Tx;

export function closeDb(): void {
  _db = undefined;
}
