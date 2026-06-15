import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {SentryInstallation} from '#db/installations.js';
import {pgTable} from './common.js';

export const sentryInstallations = pgTable(
  'installations',
  {
    id: uuidv7PrimaryKey(),
    // Null until a logged-in user claims the verified install into a workspace.
    // An unclaimed install (`connection_id IS NULL`, `status='installed'`) is
    // persisted by the authoritative webhook before any browser claim arrives.
    connectionId: uuid('connection_id'),
    installationUuid: text('installation_uuid').notNull(),
    orgSlug: text('org_slug').notNull(),
    status: text('status').notNull(),
    // sha256(authorization code) of the exchange that verified this install.
    // The claim presents the code and we match the hash, so a bare uuid alone
    // cannot bind the install (IDOR guard) without storing a live credential.
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
