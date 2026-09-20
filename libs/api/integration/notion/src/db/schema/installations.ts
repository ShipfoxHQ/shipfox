import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {NotionInstallation} from '#db/installations.js';
import {pgTable} from './common.js';

export const notionInstallations = pgTable(
  'installations',
  {
    id: uuidv7PrimaryKey(),
    connectionId: uuid('connection_id').notNull(),
    notionWorkspaceId: uuid('notion_workspace_id').notNull(),
    workspaceName: text('workspace_name').notNull(),
    botId: uuid('bot_id').notNull(),
    authorizedByUserId: uuid('authorized_by_user_id').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', {withTimezone: true}),
    status: text('status').notNull().$type<NotionInstallation['status']>(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_notion_installations_connection_unique').on(table.connectionId),
    uniqueIndex('integrations_notion_installations_workspace_unique').on(table.notionWorkspaceId),
  ],
);

export type NotionInstallationDb = typeof notionInstallations.$inferSelect;
export type NotionInstallationCreateDb = typeof notionInstallations.$inferInsert;

export function toNotionInstallation(row: NotionInstallationDb): NotionInstallation {
  return {
    id: row.id,
    connectionId: row.connectionId,
    notionWorkspaceId: row.notionWorkspaceId,
    workspaceName: row.workspaceName,
    botId: row.botId,
    authorizedByUserId: row.authorizedByUserId,
    tokenExpiresAt: row.tokenExpiresAt,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
