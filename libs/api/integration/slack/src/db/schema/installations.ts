import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {SlackInstallation} from '#db/installations.js';
import {pgTable} from './common.js';

export const slackInstallations = pgTable(
  'installations',
  {
    id: uuidv7PrimaryKey(),
    connectionId: uuid('connection_id').notNull(),
    teamId: text('team_id').notNull(),
    teamName: text('team_name').notNull(),
    appId: text('app_id').notNull(),
    botUserId: text('bot_user_id').notNull(),
    scopes: jsonb('scopes').notNull().$type<string[]>(),
    status: text('status').notNull().$type<SlackInstallation['status']>(),
    tokenExpiresAt: timestamp('token_expires_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_slack_installations_connection_unique').on(table.connectionId),
    uniqueIndex('integrations_slack_installations_team_unique').on(table.teamId),
  ],
);

export type SlackInstallationDb = typeof slackInstallations.$inferSelect;
export type SlackInstallationCreateDb = typeof slackInstallations.$inferInsert;

export function toSlackInstallation(row: SlackInstallationDb): SlackInstallation {
  return {
    id: row.id,
    connectionId: row.connectionId,
    teamId: row.teamId,
    teamName: row.teamName,
    appId: row.appId,
    botUserId: row.botUserId,
    scopes: row.scopes,
    status: row.status,
    tokenExpiresAt: row.tokenExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
