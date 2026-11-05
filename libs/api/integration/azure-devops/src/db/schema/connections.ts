import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {AzureDevOpsConnection} from '#db/connections.js';
import {pgTable} from './common.js';

export const azureDevOpsConnections = pgTable(
  'connections',
  {
    id: uuidv7PrimaryKey(),
    connectionId: uuid('connection_id').notNull(),
    organization: text('organization').notNull(),
    webhookUsername: text('webhook_username').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_azure_devops_connections_connection_unique').on(table.connectionId),
    uniqueIndex('integrations_azure_devops_connections_organization_unique').on(table.organization),
  ],
);

export type AzureDevOpsConnectionDb = typeof azureDevOpsConnections.$inferSelect;
export type AzureDevOpsConnectionCreateDb = typeof azureDevOpsConnections.$inferInsert;

export function toAzureDevOpsConnection(row: AzureDevOpsConnectionDb): AzureDevOpsConnection {
  return {
    id: row.id,
    connectionId: row.connectionId,
    organization: row.organization,
    webhookUsername: row.webhookUsername,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
