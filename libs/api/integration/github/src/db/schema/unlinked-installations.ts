import {text, timestamp, uniqueIndex} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const githubUnlinkedInstallations = pgTable(
  'unlinked_installations',
  {
    installationId: text('installation_id').notNull(),
    accountLogin: text('account_login').notNull(),
    accountType: text('account_type').notNull(),
    repositorySelection: text('repository_selection').notNull(),
    senderLogin: text('sender_login'),
    requesterLogin: text('requester_login'),
    lastAction: text('last_action').notNull(),
    firstSeenAt: timestamp('first_seen_at', {withTimezone: true}).notNull(),
    lastSeenAt: timestamp('last_seen_at', {withTimezone: true}).notNull(),
  },
  (table) => [
    uniqueIndex('integrations_github_unlinked_installations_installation_unique').on(
      table.installationId,
    ),
  ],
);

export type GithubUnlinkedInstallationDb = typeof githubUnlinkedInstallations.$inferSelect;
export type GithubUnlinkedInstallationCreateDb = typeof githubUnlinkedInstallations.$inferInsert;
