import {integer, text, timestamp, uuid, varchar} from 'drizzle-orm/pg-core';
import type {JamInstallation} from '#db/installations.js';
import {pgTable} from './common.js';

export const jamInstallations = pgTable('installations', {
  connectionId: uuid('connection_id').primaryKey().notNull(),
  teamId: text('team_id').notNull(),
  userId: text('user_id').notNull(),
  userName: text('user_name').notNull(),
  userEmail: text('user_email'),
  tokenHint: varchar('token_hint', {length: 4}).notNull(),
  credentialVersion: integer('credential_version').notNull().default(1),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
});

export type JamInstallationDb = typeof jamInstallations.$inferSelect;
export type JamInstallationCreateDb = typeof jamInstallations.$inferInsert;

export function toJamInstallation(row: JamInstallationDb): JamInstallation {
  return {
    connectionId: row.connectionId,
    teamId: row.teamId,
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    tokenHint: row.tokenHint,
    credentialVersion: row.credentialVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
