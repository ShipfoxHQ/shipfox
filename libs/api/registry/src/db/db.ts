import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {registryIndexes} from './schema/indexes.js';
import {registryVersions} from './schema/versions.js';

export const schema = {registryIndexes, registryVersions};

export type Database = NodePgDatabase<typeof schema>;

let _db: Database | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
