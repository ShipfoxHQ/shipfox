import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {annotations} from './schema/annotations.js';

export const schema = {annotations};

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

let _db: Database | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
