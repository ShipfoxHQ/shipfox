import type {Buffer} from 'node:buffer';
import {closeStream} from '#core/close-stream.js';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {insertChunk} from '#db/chunks.js';
import {db} from '#db/db.js';
import {getOrCreateAttemptStream} from '#db/streams.js';

export interface ClosedStreamIdentity {
  jobId: string;
  stepId: string;
  attempt: number;
  workspaceId: string;
  projectId: string;
  runId: string;
}

export interface ArrangeClosedStreamOptions {
  /** Runner chunk bodies, inserted in order with increasing `stream_offset`. */
  chunks?: Buffer[];
  /** Close via the timeout path, appending a `runner_lost` control chunk (no runner chunks). */
  tombstone?: boolean;
}

/** Arranges a closed stream with the given chunks, the precondition compaction runs against. */
export function arrangeClosedStream(
  identity: ClosedStreamIdentity,
  options: ArrangeClosedStreamOptions = {},
): Promise<AttemptStream> {
  const chunks = options.chunks ?? [];

  return db().transaction(async (tx) => {
    const stream = await getOrCreateAttemptStream(tx, identity);

    let offset = 0;
    for (const data of chunks) {
      await insertChunk(tx, {
        streamId: stream.id,
        streamOffset: offset,
        byteLen: data.length,
        data,
        origin: 'runner',
      });
      offset += data.length;
    }

    const closed = await closeStream(tx, {
      streamId: stream.id,
      reason: options.tombstone ? 'timeout' : 'declared',
    });

    return closed ?? stream;
  });
}
