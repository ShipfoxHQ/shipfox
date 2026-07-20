import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const capacityBootstrapCredentials = pgTable(
  'capacity_bootstrap_credentials',
  {
    id: uuidv7PrimaryKey(),
    capacityId: uuid('capacity_id').notNull(),
    provisionerId: uuid('provisioner_id').notNull(),
    hashedToken: text('hashed_token').notNull(),
    prefix: text('prefix').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    consumedAt: timestamp('consumed_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_capacity_bootstrap_credentials_hashed_token_unique').on(table.hashedToken),
    index('runners_capacity_bootstrap_credentials_capacity_idx').on(
      table.capacityId,
      table.consumedAt,
      table.expiresAt,
    ),
  ],
);

export const capacitySessions = pgTable(
  'capacity_sessions',
  {
    id: uuidv7PrimaryKey(),
    capacityId: uuid('capacity_id').notNull(),
    provisionerId: uuid('provisioner_id').notNull(),
    hashedToken: text('hashed_token').notNull(),
    prefix: text('prefix').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    closedAt: timestamp('closed_at', {withTimezone: true}),
    lastSeenAt: timestamp('last_seen_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_capacity_sessions_hashed_token_unique').on(table.hashedToken),
    uniqueIndex('runners_capacity_sessions_capacity_active_unique')
      .on(table.capacityId)
      .where(sql`${table.closedAt} is null`),
  ],
);
