import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {SentryInstallation} from '#db/installations.js';
import {pgTable} from './common.js';

export const sentryInstallations = pgTable(
  'installations',
  {
    id: uuidv7PrimaryKey(),
    connectionId: uuid('connection_id').notNull(),
    installationUuid: text('installation_uuid').notNull(),
    orgSlug: text('org_slug').notNull(),
    status: text('status').notNull(),
    installerUserId: uuid('installer_user_id'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_sentry_installations_connection_unique').on(table.connectionId),
    uniqueIndex('integrations_sentry_installations_installation_unique').on(table.installationUuid),
  ],
);

export type SentryInstallationDb = typeof sentryInstallations.$inferSelect;
export type SentryInstallationCreateDb = typeof sentryInstallations.$inferInsert;

export function toSentryInstallation(row: SentryInstallationDb): SentryInstallation {
  return {
    id: row.id,
    connectionId: row.connectionId,
    installationUuid: row.installationUuid,
    orgSlug: row.orgSlug,
    status: row.status,
    installerUserId: row.installerUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
