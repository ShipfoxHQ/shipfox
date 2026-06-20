import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {triggersDecisions} from './schema/decisions.js';
import {triggersOutbox} from './schema/outbox.js';
import {triggersReceivedEvents} from './schema/received-events.js';
import {triggerSubscriptions} from './schema/subscriptions.js';

export const schema = {
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

export function closeDb(): void {
  _db = undefined;
}
