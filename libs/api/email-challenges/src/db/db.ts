import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {challenges} from './schema/challenges.js';
import {sendLimits} from './schema/send-limits.js';

const schema = {challenges, sendLimits};
let client: NodePgDatabase<typeof schema> | undefined;
export function db() {
  if (!client) client = drizzle(pgClient(), {schema});
  return client;
}
export function closeDb() {
  client = undefined;
}
export type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];
