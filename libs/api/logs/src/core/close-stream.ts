import {Buffer} from 'node:buffer';
import {LOG_STREAM_CLOSED, type LogRecord, type LogsEventMap} from '@shipfox/api-logs-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import type {AttemptStream, StreamCloseReason} from '#core/entities/attempt-stream.js';
import {insertChunk} from '#db/chunks.js';
import type {Transaction} from '#db/db.js';
import {logsOutbox} from '#db/schema/outbox.js';
import {markStreamClosed} from '#db/streams.js';

/** Server-originated control records the server injects into a stream as tombstone chunks. */
export type TombstoneKind = 'capped' | 'runner_lost';

/**
 * Frames a server tombstone as one newline-terminated v1 NDJSON record. Typed
 * against the shared contract so an envelope change breaks this at compile time.
 * Stored as a `control` chunk; like every server record it does NOT advance
 * `committed_length`, so the CAS axis stays equal to runner spool bytes.
 */
export function controlTombstone(kind: TombstoneKind): Buffer {
  const record: LogRecord = {v: 1, ts: Date.now(), src: 'system', type: 'control', kind};
  return Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
}

export interface CloseStreamParams {
  streamId: string;
  reason: StreamCloseReason;
  /**
   * When set, the stream is marked `truncated` and the tombstone is appended as a
   * `control` chunk at the current offset (no `committed_length` advance). Used by
   * the timeout path (`runner_lost`); the declared path passes none.
   */
  tombstone?: Buffer;
}

/**
 * Closes a stream exactly once. The guarded UPDATE (`WHERE state='open'`) is the
 * lock and the idempotency gate: a stream already closed by the other path (the
 * append-time declared close vs the job-terminated timeout sweep) returns null,
 * so no duplicate `LOG_STREAM_CLOSED` is written and no second tombstone lands.
 * The event drives compaction; it is written in the same transaction as the flip.
 */
export async function closeStream(
  tx: Transaction,
  params: CloseStreamParams,
): Promise<AttemptStream | null> {
  const closed = await markStreamClosed(tx, {
    streamId: params.streamId,
    reason: params.reason,
    markTruncated: params.tombstone !== undefined,
  });
  if (!closed) return null;

  if (params.tombstone) {
    await insertChunk(tx, {
      streamId: closed.id,
      streamOffset: closed.committedLength,
      byteLen: params.tombstone.length,
      data: params.tombstone,
      kind: 'control',
    });
  }

  await writeOutboxEvent<LogsEventMap>(tx, logsOutbox, {
    type: LOG_STREAM_CLOSED,
    payload: {
      workspaceId: closed.workspaceId,
      jobId: closed.jobId,
      stepId: closed.stepId,
      attempt: closed.attempt,
      streamId: closed.id,
    },
  });

  return closed;
}
