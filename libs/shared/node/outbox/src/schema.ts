import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {getTableName, sql} from 'drizzle-orm';
import {index, jsonb, type pgTableCreator, text, timestamp} from 'drizzle-orm/pg-core';

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
      payload: jsonb('payload').notNull(),
      createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
      dispatchedAt: timestamp('dispatched_at', {withTimezone: true}),
    },
    (table) => [
      index(`${tableName}_pending_idx`).on(table.createdAt).where(sql`"dispatched_at" IS NULL`),
    ],
  );
}

export type OutboxTable = ReturnType<typeof createOutboxTable>;
