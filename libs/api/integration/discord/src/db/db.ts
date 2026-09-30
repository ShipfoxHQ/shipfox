import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {discordGatewaySessions} from './schema/gateway-sessions.js';
import {discordInstallations} from './schema/installations.js';

export const schema = {discordGatewaySessions, discordInstallations};

let database: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!database) database = drizzle(pgClient(), {schema});
  return database;
}

export function closeDb(): void {
  database = undefined;
}
