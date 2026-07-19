import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {JiraInstallation} from '#db/installations.js';
import {pgTable} from './common.js';

export const jiraInstallations = pgTable(
  'installations',
  {
    id: uuidv7PrimaryKey(),
    connectionId: uuid('connection_id').notNull(),
    cloudId: text('cloud_id').notNull(),
    siteUrl: text('site_url').notNull(),
    siteName: text('site_name').notNull(),
    authorizingAccountId: text('authorizing_account_id').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    webhookIds: jsonb('webhook_ids').$type<number[]>().notNull().default([]),
    webhookExpiresAt: timestamp('webhook_expires_at', {withTimezone: true}),
    status: text('status').notNull().$type<JiraInstallation['status']>(),
    tokenExpiresAt: timestamp('token_expires_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_jira_installations_connection_unique').on(table.connectionId),
    uniqueIndex('integrations_jira_installations_cloud_id_unique').on(table.cloudId),
  ],
);

export type JiraInstallationDb = typeof jiraInstallations.$inferSelect;
export type JiraInstallationCreateDb = typeof jiraInstallations.$inferInsert;

export function toJiraInstallation(row: JiraInstallationDb): JiraInstallation {
  return {
    id: row.id,
    connectionId: row.connectionId,
    cloudId: row.cloudId,
    siteUrl: row.siteUrl,
    siteName: row.siteName,
    authorizingAccountId: row.authorizingAccountId,
    scopes: row.scopes,
    webhookIds: row.webhookIds,
    webhookExpiresAt: row.webhookExpiresAt,
    status: row.status,
    tokenExpiresAt: row.tokenExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
