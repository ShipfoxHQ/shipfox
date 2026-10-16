import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {jamInstallations} from './schema/installations.js';

export const schema = {jamInstallations};

type JamSchema = typeof schema;
let _db: NodePgDatabase<JamSchema> | undefined;

export function db(): NodePgDatabase<JamSchema> {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
