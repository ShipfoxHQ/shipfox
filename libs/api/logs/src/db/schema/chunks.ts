import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {bigint, bigserial, index, integer, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {attemptStreams} from './attempt-streams.js';
import {bytea, pgTable} from './common.js';

/**
 * Hot, append-only log bytes for open streams, pending compaction (ENG-442).
 *
 * Two byte axes meet here and MUST stay distinct:
 *
 *   Runner spool (CAS axis)          Stored chunk stream (read axis, by seq)
 *   offset 0 ┌────────────┐  ───►  seq 1 │ chunk A   │ kind=runner  (counts to committed_length)
 *      100   ├─ chunk A ──┤  ───►  seq 2 │ chunk B   │ kind=runner  (counts to committed_length)
 *      250   ├─ chunk B ──┤  ───►  seq 3 │ {capped}  │ kind=control ← server-injected; does NOT
 *            └────────────┘                              advance committed_length
 *
 * `stream_offset` is the runner-axis position of a runner chunk; for a server
 * `control` chunk it is informational. `seq` (insertion order) is the read axis
 * the reader walks, so server records interleave correctly with runner bytes.
 */
export const logChunks = pgTable(
  'chunks',
  {
    id: uuidv7PrimaryKey(),
    streamId: uuid('stream_id')
      .notNull()
      .references(() => attemptStreams.id),
    seq: bigserial('seq', {mode: 'number'}).notNull(),
    streamOffset: bigint('stream_offset', {mode: 'number'}).notNull(),
    byteLen: integer('byte_len').notNull(),
    data: bytea('data').notNull(),
    kind: text('kind', {enum: ['runner', 'control']}).notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [index('logs_chunks_stream_seq_idx').on(table.streamId, table.seq)],
);

export type LogChunkDb = typeof logChunks.$inferSelect;
export type LogChunkInsertDb = typeof logChunks.$inferInsert;

export type ChunkKind = 'runner' | 'control';
