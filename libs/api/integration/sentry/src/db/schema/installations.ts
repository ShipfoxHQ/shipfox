import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {SentryInstallation, SentryInstallationRowStatus} from '#db/installations.js';
import {pgTable} from './common.js';

export const sentryInstallations = pgTable(
  'installations',
  {
    id: uuidv7PrimaryKey(),
    // Null until a logged-in user claims the verified install into a workspace.
    // Pending and verified installs remain unclaimed until the browser binds a
    // connection. Deleted rows are terminal tombstones.
    connectionId: uuid('connection_id'),
    installationUuid: text('installation_uuid').notNull(),
    orgSlug: text('org_slug').notNull(),
    status: text('status').notNull().$type<SentryInstallationRowStatus>(),
    // sha256(authorization code) claimed for this install. The hash identifies
    // which pending exchange reached the durable success checkpoint and keeps a
    // bare uuid from binding an install (IDOR guard) without storing a credential.
    codeHash: text('code_hash'),
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
    codeHash: row.codeHash,
    installerUserId: row.installerUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
