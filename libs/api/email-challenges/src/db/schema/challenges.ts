import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {isNull} from 'drizzle-orm';
import {index, integer, text, timestamp, uniqueIndex} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const challenges = pgTable(
  'challenges',
  {
    id: uuidv7PrimaryKey(),
    email: text('email'),
    purpose: text('purpose').notNull(),
    continuationHmac: text('continuation_hmac'),
    idempotencyHmac: text('idempotency_hmac').notNull(),
    codeHmac: text('code_hmac'),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    sentCount: integer('sent_count').notNull().default(1),
    resendCount: integer('resend_count').notNull().default(0),
    failedAttemptCount: integer('failed_attempt_count').notNull().default(0),
    lastSentAt: timestamp('last_sent_at', {withTimezone: true}).notNull().defaultNow(),
    deliveryState: text('delivery_state').notNull().default('pending'),
    deliveryAttemptedAt: timestamp('delivery_attempted_at', {withTimezone: true}),
    deliveredAt: timestamp('delivered_at', {withTimezone: true}),
    deliveryFailedAt: timestamp('delivery_failed_at', {withTimezone: true}),
    confirmedAt: timestamp('confirmed_at', {withTimezone: true}),
    proofExpiresAt: timestamp('proof_expires_at', {withTimezone: true}),
    consumedAt: timestamp('consumed_at', {withTimezone: true}),
    consumedContinuationHmac: text('consumed_continuation_hmac'),
    invalidatedAt: timestamp('invalidated_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    terminalAt: timestamp('terminal_at', {withTimezone: true}),
  },
  (table) => [
    uniqueIndex('email_challenges_idempotency_unique')
      .on(table.idempotencyHmac)
      .where(isNull(table.terminalAt)),
    index('email_challenges_expiry_idx').on(table.expiresAt),
    index('email_challenges_terminal_idx').on(table.terminalAt),
  ],
);
