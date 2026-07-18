import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {slackInstallations} from './schema/installations.js';

export const schema = {slackInstallations};

let database: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!database) database = drizzle(pgClient(), {schema});
  return database;
}

export function closeDb(): void {
  database = undefined;
}
