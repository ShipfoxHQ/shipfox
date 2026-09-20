import {integer, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {PosthogInstallation} from '#db/installations.js';
import {pgTable} from './common.js';

export const posthogInstallations = pgTable('installations', {
  connectionId: uuid('connection_id').primaryKey().notNull(),
  projectId: text('project_id').notNull(),
  projectName: text('project_name').notNull(),
  organizationId: text('organization_id').notNull(),
  keyHint: text('key_hint').notNull(),
  credentialVersion: integer('credential_version').notNull().default(1),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
});

export type PosthogInstallationDb = typeof posthogInstallations.$inferSelect;
export type PosthogInstallationCreateDb = typeof posthogInstallations.$inferInsert;

export function toPosthogInstallation(row: PosthogInstallationDb): PosthogInstallation {
  return {
    connectionId: row.connectionId,
    projectId: row.projectId,
    projectName: row.projectName,
    organizationId: row.organizationId,
    keyHint: row.keyHint,
    credentialVersion: row.credentialVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
