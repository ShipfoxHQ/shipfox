import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {jiraInstallations} from './schema/installations.js';
import {jiraPendingSelections} from './schema/pending-selections.js';

export const schema = {jiraInstallations, jiraPendingSelections};

let database: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!database) database = drizzle(pgClient(), {schema});
  return database;
}

export function closeDb(): void {
  database = undefined;
}
