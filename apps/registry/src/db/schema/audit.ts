import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, jsonb, text, timestamp} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

/** Publish attempts and refused token exchanges. Rows are inserted once and never updated. */
export const audit = pgTable(
  'audit',
  {
    id: uuidv7PrimaryKey(),
    at: timestamp('at', {withTimezone: true}).notNull().defaultNow(),
    event: text('event').notNull(),
    outcome: text('outcome').notNull(),
    reason: text('reason'),
    namespace: text('namespace'),
    package: text('package'),
    version: text('version'),
    detail: jsonb('detail').notNull().default({}),
  },
  (table) => [
    index('registry_audit_at_idx').on(table.at),
    index('registry_audit_namespace_idx').on(table.namespace),
  ],
);
