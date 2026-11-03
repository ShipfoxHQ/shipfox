import {integer, primaryKey, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';
import {turns} from './turns.js';

/**
 * A write tool call that has begun. Its row is committed before the call runs, so a repeat of the
 * same call finds it and reports an unknown outcome instead of writing twice.
 */
export const toolCallStarts = pgTable(
  'tool_call_starts',
  {
    turnId: uuid('turn_id')
      .notNull()
      .references(() => turns.id, {onDelete: 'cascade'}),
    modelCallIndex: integer('model_call_index').notNull(),
    callIndex: integer('call_index').notNull(),
    startedAt: timestamp('started_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'agent_tool_call_starts_pkey',
      columns: [table.turnId, table.modelCallIndex, table.callIndex],
    }),
  ],
);
