import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {RefreshToken} from '#core/entities/refresh-token.js';
import {pgTable} from './common.js';
import {users} from './users.js';

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuidv7PrimaryKey(),
    sessionId: uuid('session_id').notNull().default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    hashedToken: text('hashed_token').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    rotatedAt: timestamp('rotated_at', {withTimezone: true}),
    lastUsedAt: timestamp('last_used_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_refresh_tokens_hashed_token_unique').on(table.hashedToken),
    uniqueIndex('auth_refresh_tokens_active_session_unique')
      .on(table.userId, table.sessionId)
      .where(sql`${table.revokedAt} IS NULL AND ${table.rotatedAt} IS NULL`),
    index('auth_refresh_tokens_user_id_idx').on(table.userId),
  ],
);

export type RefreshTokenDb = typeof refreshTokens.$inferSelect;
export type RefreshTokenCreateDb = typeof refreshTokens.$inferInsert;

export function toRefreshToken(row: RefreshTokenDb): RefreshToken {
  return {
    id: row.id,
    sessionId: row.sessionId,
    userId: row.userId,
    hashedToken: row.hashedToken,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    rotatedAt: row.rotatedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
