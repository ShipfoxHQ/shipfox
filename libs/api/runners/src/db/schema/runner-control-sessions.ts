import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const runnerBootstrapTokens = pgTable(
  'runner_bootstrap_tokens',
  {
    id: uuidv7PrimaryKey(),
    runnerInstanceId: uuid('runner_instance_id').notNull(),
    provisionerId: uuid('provisioner_id').notNull(),
    hashedToken: text('hashed_token').notNull(),
    prefix: text('prefix').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    consumedAt: timestamp('consumed_at', {withTimezone: true}),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_runner_bootstrap_tokens_hashed_token_unique').on(table.hashedToken),
    index('runners_runner_bootstrap_tokens_runner_instance_idx').on(table.runnerInstanceId),
  ],
);

export const runnerControlSessions = pgTable(
  'runner_control_sessions',
  {
    id: uuidv7PrimaryKey(),
    runnerInstanceId: uuid('runner_instance_id').notNull(),
    provisionerId: uuid('provisioner_id').notNull(),
    hashedToken: text('hashed_token').notNull(),
    prefix: text('prefix').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    lastSeenAt: timestamp('last_seen_at', {withTimezone: true}).notNull().defaultNow(),
    closedAt: timestamp('closed_at', {withTimezone: true}),
    closeReason: text('close_reason'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_runner_control_sessions_hashed_token_unique').on(table.hashedToken),
    uniqueIndex('runners_runner_control_sessions_active_runner_instance_unique')
      .on(table.runnerInstanceId)
      .where(sql`"closed_at" is null`),
    index('runners_runner_control_sessions_runner_instance_idx').on(table.runnerInstanceId),
  ],
);
