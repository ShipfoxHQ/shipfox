import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {ClickUpInstallation} from '#db/installations.js';
import {pgTable} from './common.js';

export const clickupInstallations = pgTable(
  'installations',
  {
    id: uuidv7PrimaryKey(),
    connectionId: uuid('connection_id').notNull(),
    teamId: text('team_id').notNull(),
    teamName: text('team_name').notNull(),
    authorizingUserId: text('authorizing_user_id').notNull(),
    webhookId: text('webhook_id'),
    status: text('status').notNull().$type<ClickUpInstallation['status']>(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_clickup_installations_connection_unique').on(table.connectionId),
    uniqueIndex('integrations_clickup_installations_team_unique').on(table.teamId),
  ],
);

export type ClickUpInstallationDb = typeof clickupInstallations.$inferSelect;
export type ClickUpInstallationCreateDb = typeof clickupInstallations.$inferInsert;

export function toClickUpInstallation(row: ClickUpInstallationDb): ClickUpInstallation {
  return {
    id: row.id,
    connectionId: row.connectionId,
    teamId: row.teamId,
    teamName: row.teamName,
    authorizingUserId: row.authorizingUserId,
    webhookId: row.webhookId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
