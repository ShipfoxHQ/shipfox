import type {Buffer} from 'node:buffer';
import {and, asc, eq, gt, sql} from 'drizzle-orm';
import {db, type Transaction} from './db.js';
import {type ChunkOrigin, logChunks} from './schema/chunks.js';

export interface InsertChunkParams {
  streamId: string;
  streamOffset: number;
  byteLen: number;
  data: Buffer;
  origin: ChunkOrigin;
}

export async function insertChunk(tx: Transaction, params: InsertChunkParams): Promise<void> {
  await tx.insert(logChunks).values({
    streamId: params.streamId,
    streamOffset: params.streamOffset,
    byteLen: params.byteLen,
    data: params.data,
    origin: params.origin,
  });
}

export interface ChunkPageRow {
  seq: number;
  data: Buffer;
}

/**
 * One keyset page of a stream's chunk bytes in `seq` order. Compaction walks pages
 * with `afterSeq = lastSeqOfPreviousPage`, so memory stays flat regardless of stream
 * size, and reads run outside any transaction (no tx is pinned for the long upload).
 * Safe against late writers because a closed stream never accepts another chunk.
 */
export async function readChunksKeyset(params: {
  streamId: string;
  afterSeq: number;
  limit: number;
}): Promise<ChunkPageRow[]> {
  const rows = await db()
    .select({seq: logChunks.seq, data: logChunks.data})
    .from(logChunks)
    .where(and(eq(logChunks.streamId, params.streamId), gt(logChunks.seq, params.afterSeq)))
    .orderBy(asc(logChunks.seq))
    .limit(params.limit);
  return rows;
}

export interface ChunkStats {
  count: number;
  maxSeq: number;
  uncompressedBytes: number;
}

/**
 * Aggregate of a stream's chunks: row count, highest `seq`, and total stored bytes.
 * Compaction reads this once before uploading, both to stamp object metadata and as the
 * baseline its streamed totals are checked against before the chunk rows are deleted.
 */
export async function chunkStats(streamId: string): Promise<ChunkStats> {
  const [row] = await db()
    .select({
      count: sql<number>`count(*)::int`,
      maxSeq: sql<number>`coalesce(max(${logChunks.seq}), 0)::int`,
      uncompressedBytes: sql<string>`coalesce(sum(${logChunks.byteLen}), 0)::text`,
    })
    .from(logChunks)
    .where(eq(logChunks.streamId, streamId));

  return {
    count: row?.count ?? 0,
    maxSeq: row?.maxSeq ?? 0,
    uncompressedBytes: Number(row?.uncompressedBytes ?? '0'),
  };
}
