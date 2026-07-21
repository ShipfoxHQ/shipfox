import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const runnerActivationTokens = pgTable(
  'runner_activation_tokens',
  {
    id: uuidv7PrimaryKey(),
    runnerInstanceId: uuid('runner_instance_id').notNull(),
    hashedToken: text('hashed_token').notNull(),
    prefix: text('prefix').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    consumedAt: timestamp('consumed_at', {withTimezone: true}),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    consumedSessionId: uuid('consumed_session_id'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_runner_activation_tokens_hashed_token_unique').on(table.hashedToken),
    index('runners_runner_activation_tokens_runner_instance_idx').on(table.runnerInstanceId),
  ],
);
