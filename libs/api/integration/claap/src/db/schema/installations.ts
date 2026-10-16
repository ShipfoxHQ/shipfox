import {integer, text, timestamp, uuid, varchar} from 'drizzle-orm/pg-core';
import type {ClaapInstallation} from '#db/installations.js';
import {pgTable} from './common.js';

export const claapInstallations = pgTable('installations', {
  connectionId: uuid('connection_id').primaryKey().notNull(),
  workspaceId: text('workspace_id').notNull(),
  workspaceName: text('workspace_name').notNull(),
  keyHint: varchar('key_hint', {length: 4}).notNull(),
  credentialVersion: integer('credential_version').notNull().default(1),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
});

export type ClaapInstallationDb = typeof claapInstallations.$inferSelect;

export function toClaapInstallation(row: ClaapInstallationDb): ClaapInstallation {
  return {
    connectionId: row.connectionId,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    keyHint: row.keyHint,
    credentialVersion: row.credentialVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
