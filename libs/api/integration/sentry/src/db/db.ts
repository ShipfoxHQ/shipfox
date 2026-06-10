import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {sentryInstallations} from './schema/installations.js';

export const schema = {
  sentryInstallations,
};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
