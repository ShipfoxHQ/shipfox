import {integer, primaryKey, timestamp, uuid} from 'drizzle-orm/pg-core';
import {bytea, pgTable} from './common.js';
import {turns} from './turns.js';

/** Sealed text deltas of the running model call. The final assistant item replaces them. */
export const turnStreamChunks = pgTable(
  'turn_stream_chunks',
  {
    turnId: uuid('turn_id')
      .notNull()
      .references(() => turns.id, {onDelete: 'cascade'}),
    modelCallIndex: integer('model_call_index').notNull(),
    chunkSeq: integer('chunk_seq').notNull(),
    body: bytea('body').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'agent_turn_stream_chunks_pkey',
      columns: [table.turnId, table.modelCallIndex, table.chunkSeq],
    }),
  ],
);
