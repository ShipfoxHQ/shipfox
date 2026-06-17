import type {Buffer} from 'node:buffer';
import type {Transaction} from './db.js';
import {type ChunkKind, logChunks} from './schema/chunks.js';

export interface InsertChunkParams {
  streamId: string;
  streamOffset: number;
  byteLen: number;
  data: Buffer;
  kind: ChunkKind;
}

export async function insertChunk(tx: Transaction, params: InsertChunkParams): Promise<void> {
  await tx.insert(logChunks).values({
    streamId: params.streamId,
    streamOffset: params.streamOffset,
    byteLen: params.byteLen,
    data: params.data,
    kind: params.kind,
  });
}
