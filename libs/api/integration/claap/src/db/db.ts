import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {claapInstallations} from './schema/installations.js';

export const schema = {claapInstallations};

type ClaapSchema = typeof schema;
let _db: NodePgDatabase<ClaapSchema> | undefined;

export function db(): NodePgDatabase<ClaapSchema> {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
