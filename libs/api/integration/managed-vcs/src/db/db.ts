import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {managedObjects} from './schema/objects.js';
import {managedRefs} from './schema/refs.js';
import {managedRepositories} from './schema/repositories.js';

export const schema = {
  managedObjects,
  managedRefs,
  managedRepositories,
};

export type ManagedDb = NodePgDatabase<typeof schema>;
export type ManagedTx = Parameters<Parameters<ManagedDb['transaction']>[0]>[0];

let _db: ManagedDb | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
