import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {notionInstallations} from './schema/installations.js';

export const schema = {notionInstallations};

type NotionDatabase = NodePgDatabase<typeof schema>;
let database: NotionDatabase | undefined;

export function db(): NotionDatabase {
  if (!database) database = drizzle(pgClient(), {schema});
  return database;
}

export function closeDb(): void {
  database = undefined;
}
