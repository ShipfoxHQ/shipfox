import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {GiteaConnection} from '#db/connections.js';
import {pgTable} from './common.js';

export const giteaConnections = pgTable(
  'connections',
  {
    id: uuidv7PrimaryKey(),
    connectionId: uuid('connection_id').notNull(),
    org: text('org').notNull(),
    webhookId: text('webhook_id').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_gitea_connections_connection_unique').on(table.connectionId),
    uniqueIndex('integrations_gitea_connections_org_unique').on(table.org),
  ],
);

export type GiteaConnectionDb = typeof giteaConnections.$inferSelect;
export type GiteaConnectionCreateDb = typeof giteaConnections.$inferInsert;

export function toGiteaConnection(row: GiteaConnectionDb): GiteaConnection {
  return {
    id: row.id,
    connectionId: row.connectionId,
    org: row.org,
    webhookId: row.webhookId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
