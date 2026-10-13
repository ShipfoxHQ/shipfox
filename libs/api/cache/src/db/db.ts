import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {cacheDeletions} from './schema/deletions.js';
import {cacheEntries} from './schema/entries.js';
import {cacheWorkspaceSettings} from './schema/workspace-settings.js';

export const schema = {cacheEntries, cacheWorkspaceSettings, cacheDeletions};

export type Database = NodePgDatabase<typeof schema>;

let _db: Database | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
