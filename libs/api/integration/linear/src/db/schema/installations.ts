import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {LinearInstallation} from '#db/installations.js';
import {pgTable} from './common.js';

export const linearInstallations = pgTable(
  'installations',
  {
    id: uuidv7PrimaryKey(),
    connectionId: uuid('connection_id').notNull(),
    organizationId: text('organization_id').notNull(),
    organizationUrlKey: text('organization_url_key').notNull(),
    appUserId: text('app_user_id').notNull(),
    scopes: jsonb('scopes').notNull().$type<string[]>(),
    tokenExpiresAt: timestamp('token_expires_at', {withTimezone: true}),
    status: text('status').notNull().$type<LinearInstallation['status']>(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_linear_installations_connection_unique').on(table.connectionId),
    uniqueIndex('integrations_linear_installations_organization_unique').on(table.organizationId),
  ],
);

export type LinearInstallationDb = typeof linearInstallations.$inferSelect;
export type LinearInstallationCreateDb = typeof linearInstallations.$inferInsert;

export function toLinearInstallation(row: LinearInstallationDb): LinearInstallation {
  return {
    id: row.id,
    connectionId: row.connectionId,
    organizationId: row.organizationId,
    organizationUrlKey: row.organizationUrlKey,
    appUserId: row.appUserId,
    scopes: row.scopes,
    tokenExpiresAt: row.tokenExpiresAt,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
