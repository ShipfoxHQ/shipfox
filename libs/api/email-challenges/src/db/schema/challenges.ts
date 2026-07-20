import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, integer, text, timestamp} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const challenges = pgTable(
  'challenges',
  {
    id: uuidv7PrimaryKey(),
    email: text('email'),
    purpose: text('purpose').notNull(),
    continuationHmac: text('continuation_hmac'),
    codeHmac: text('code_hmac'),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    sentCount: integer('sent_count').notNull().default(1),
    resendCount: integer('resend_count').notNull().default(0),
    failedAttemptCount: integer('failed_attempt_count').notNull().default(0),
    lastSentAt: timestamp('last_sent_at', {withTimezone: true}).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', {withTimezone: true}),
    proofExpiresAt: timestamp('proof_expires_at', {withTimezone: true}),
    consumedAt: timestamp('consumed_at', {withTimezone: true}),
    consumedContinuationHmac: text('consumed_continuation_hmac'),
    invalidatedAt: timestamp('invalidated_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    terminalAt: timestamp('terminal_at', {withTimezone: true}),
  },
  (table) => [
    index('email_challenges_expiry_idx').on(table.expiresAt),
    index('email_challenges_terminal_idx').on(table.terminalAt),
  ],
);
