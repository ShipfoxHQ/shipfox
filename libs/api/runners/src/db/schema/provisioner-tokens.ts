import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, index, pgEnum, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {ProvisionerToken} from '#core/entities/provisioner-token.js';
import {pgTable} from './common.js';

export const provisionerScopeEnum = pgEnum('runners_provisioner_scope', [
  'workspace',
  'installation',
]);

export const provisionerTokens = pgTable(
  'provisioner_tokens',
  {
    id: uuidv7PrimaryKey(),
    scope: provisionerScopeEnum('scope').notNull(),
    workspaceId: uuid('workspace_id'),
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
    index('runners_provisioner_tokens_workspace_last_seen_idx').on(
      table.workspaceId,
      table.lastSeenAt.desc(),
      table.id.desc(),
    ),
    check(
      'runners_provisioner_tokens_scope_workspace_ck',
      sql`(scope = 'workspace' AND workspace_id IS NOT NULL) OR (scope = 'installation' AND workspace_id IS NULL)`,
    ),
  ],
);

export type ProvisionerTokenDb = typeof provisionerTokens.$inferSelect;
export type ProvisionerTokenInsertDb = typeof provisionerTokens.$inferInsert;

export function toProvisionerToken(row: ProvisionerTokenDb): ProvisionerToken {
  if (row.scope === 'installation') {
    return {
      id: row.id,
      scope: 'installation',
      workspaceId: null,
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

  if (!row.workspaceId) throw new Error('Workspace provisioner token has no workspace');
  return {
    id: row.id,
    scope: 'workspace',
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
