import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {getTableName, sql} from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  type pgTableCreator,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export function createOutboxTable(pgTable: ReturnType<typeof pgTableCreator>) {
  // The pgTableCreator prefixes table names but not index names, and inside the
  // index callback the table reports only its unprefixed base name. Read the
  // prefixed name from a throwaway build so each module's outbox index is unique
  // in the shared schema (a bare `outbox_pending_idx` would collide across modules).
  const tableName = getTableName(pgTable('outbox', {id: uuidv7PrimaryKey()}));
  return pgTable(
    'outbox',
    {
      id: uuidv7PrimaryKey(),
      eventType: text('event_type').notNull(),
      orderingKey: text('ordering_key'),
      payload: jsonb('payload').notNull(),
      createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
      dispatchedAt: timestamp('dispatched_at', {withTimezone: true}),
      dispatchAttempts: integer('dispatch_attempts').notNull().default(0),
      nextDispatchAt: timestamp('next_dispatch_at', {withTimezone: true}).notNull().defaultNow(),
      lastDispatchError: jsonb('last_dispatch_error'),
      lastDispatchFailedAt: timestamp('last_dispatch_failed_at', {withTimezone: true}),
      deadLetteredAt: timestamp('dead_lettered_at', {withTimezone: true}),
    },
    (table) => [
      index(`${tableName}_pending_idx`)
        .on(table.nextDispatchAt, table.createdAt)
        .where(sql`"dispatched_at" IS NULL AND "dead_lettered_at" IS NULL`),
      index(`${tableName}_dispatched_retention_idx`)
        .on(table.dispatchedAt, table.id)
        .where(sql`"dispatched_at" IS NOT NULL`),
    ],
  );
}

export type OutboxTable = ReturnType<typeof createOutboxTable>;

/** Creates the PostgreSQL 18 table shape required by the leased dispatch helpers. */
export function createPostgresOutboxTable(pgTable: ReturnType<typeof pgTableCreator>) {
  const tableName = getTableName(pgTable('outbox', {id: uuidv7PrimaryKey()}));
  return pgTable(
    'outbox',
    {
      id: uuidv7PrimaryKey(),
      idempotencyKey: text('idempotency_key').notNull(),
      eventType: text('event_type').notNull(),
      orderingKey: text('ordering_key'),
      payload: jsonb('payload').notNull(),
      createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
      dispatchedAt: timestamp('dispatched_at', {withTimezone: true}),
      dispatchAttempts: integer('dispatch_attempts').notNull().default(0),
      nextDispatchAt: timestamp('next_dispatch_at', {withTimezone: true}).notNull().defaultNow(),
      leaseToken: uuid('lease_token'),
      leaseExpiresAt: timestamp('lease_expires_at', {withTimezone: true}),
      lastDispatchError: jsonb('last_dispatch_error'),
      lastDispatchFailedAt: timestamp('last_dispatch_failed_at', {withTimezone: true}),
      deadLetteredAt: timestamp('dead_lettered_at', {withTimezone: true}),
    },
    (table) => [
      uniqueIndex(`${tableName}_idempotency_key_idx`).on(table.idempotencyKey),
      uniqueIndex(`${tableName}_lease_token_idx`).on(table.leaseToken),
      index(`${tableName}_pending_idx`)
        .on(table.nextDispatchAt, table.createdAt, table.id)
        .where(sql`"dispatched_at" IS NULL AND "dead_lettered_at" IS NULL`),
      index(`${tableName}_dispatched_retention_idx`)
        .on(table.dispatchedAt, table.id)
        .where(sql`"dispatched_at" IS NOT NULL`),
    ],
  );
}

export type PostgresOutboxTable = ReturnType<typeof createPostgresOutboxTable>;
