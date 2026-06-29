import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {ProvisionerToken} from '#core/entities/provisioner-token.js';
import {pgTable} from './common.js';

export const provisionerTokens = pgTable(
  'provisioner_tokens',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    hashedToken: text('hashed_token').notNull(),
    prefix: text('prefix').notNull(),
    name: text('name'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    revokedByUserId: uuid('revoked_by_user_id'),
    expiresAt: timestamp('expires_at', {withTimezone: true}),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    lastSeenAt: timestamp('last_seen_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_provisioner_tokens_hashed_token_unique').on(table.hashedToken),
    index('runners_provisioner_tokens_workspace_id_idx').on(table.workspaceId),
  ],
);

export type ProvisionerTokenDb = typeof provisionerTokens.$inferSelect;
export type ProvisionerTokenInsertDb = typeof provisionerTokens.$inferInsert;

export function toProvisionerToken(row: ProvisionerTokenDb): ProvisionerToken {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    hashedToken: row.hashedToken,
    prefix: row.prefix,
    name: row.name,
    createdByUserId: row.createdByUserId,
    revokedByUserId: row.revokedByUserId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
