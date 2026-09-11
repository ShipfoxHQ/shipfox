import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {clickupInstallations} from './schema/installations.js';

export const schema = {clickupInstallations};

let database: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!database) database = drizzle(pgClient(), {schema});
  return database;
}

export function closeDb(): void {
  database = undefined;
}
