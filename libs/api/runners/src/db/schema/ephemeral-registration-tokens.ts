import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {EphemeralRegistrationToken} from '#core/entities/ephemeral-registration-token.js';
import {pgTable} from './common.js';

export const ephemeralRegistrationTokens = pgTable(
  'ephemeral_registration_tokens',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    provisionerId: uuid('provisioner_id').notNull(),
    reservationId: uuid('reservation_id'),
    provisionedRunnerId: text('provisioned_runner_id').notNull(),
    hashedToken: text('hashed_token').notNull(),
    prefix: text('prefix').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    consumedAt: timestamp('consumed_at', {withTimezone: true}),
    consumedSessionId: uuid('consumed_session_id'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_ephemeral_registration_tokens_hashed_token_unique').on(table.hashedToken),
    index('runners_ephemeral_registration_tokens_workspace_id_idx').on(table.workspaceId),
    index('runners_ephemeral_registration_tokens_provisioner_id_idx').on(table.provisionerId),
    index('runners_ephemeral_registration_tokens_reservation_id_idx').on(table.reservationId),
    index('runners_ephemeral_registration_tokens_active_provisioned_runner_idx').on(
      table.workspaceId,
      table.provisionerId,
      table.provisionedRunnerId,
      table.consumedAt,
      table.expiresAt,
    ),
    index('runners_ephemeral_registration_tokens_created_id_idx').on(table.createdAt, table.id),
  ],
);

export type EphemeralRegistrationTokenDb = typeof ephemeralRegistrationTokens.$inferSelect;
export type EphemeralRegistrationTokenInsertDb = typeof ephemeralRegistrationTokens.$inferInsert;

export function toEphemeralRegistrationToken(
  row: EphemeralRegistrationTokenDb,
): EphemeralRegistrationToken {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provisionerId: row.provisionerId,
    reservationId: row.reservationId,
    provisionedRunnerId: row.provisionedRunnerId,
    hashedToken: row.hashedToken,
    prefix: row.prefix,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    consumedSessionId: row.consumedSessionId,
    createdAt: row.createdAt,
  };
}
