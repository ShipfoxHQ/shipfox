import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {posthogInstallations} from './schema/installations.js';

export const schema = {posthogInstallations};

type PosthogSchema = typeof schema;
let _db: NodePgDatabase<PosthogSchema> | undefined;

export function db(): NodePgDatabase<PosthogSchema> {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
