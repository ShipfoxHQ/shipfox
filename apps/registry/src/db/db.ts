import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import * as schema from './schema/index.js';

let client: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!client) client = drizzle(pgClient(), {schema});
  return client;
}

export function closeDb() {
  client = undefined;
}
