import {Buffer} from 'node:buffer';
import {LOG_STREAM_CLOSED, type LogRecord, type LogsEventMap} from '@shipfox/api-logs-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import type {AttemptStream, StreamCloseReason} from '#core/entities/attempt-stream.js';
import {isJobCapped} from '#db/accounting.js';
import {insertChunk} from '#db/chunks.js';
import type {Transaction} from '#db/db.js';
import {logsOutbox} from '#db/schema/outbox.js';
import {markStreamCapped, markStreamClosed} from '#db/streams.js';

/** Server-originated control records the server injects into a `log_stream` as tombstone chunks. */
export type TombstoneKind = 'capped' | 'runner_lost';

/**
 * Frames a server tombstone as one newline-terminated record. Typed against the
 * shared contract so an envelope change breaks this at compile time. Stored as a
 * `control`-origin chunk; like every server record it does NOT advance
 * `committed_length`, so the CAS axis stays equal to runner spool bytes. Only
 * `log_stream` carries tombstones — `agent_session` bytes are opaque and verbatim,
 * so its terminal state is recorded as out-of-band row flags instead.
 */
export function controlTombstone(kind: TombstoneKind): Buffer {
  const record: LogRecord = {v: 1, ts: Date.now(), type: kind};
  return Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
}

export interface CloseStreamParams {
  streamId: string;
  reason: StreamCloseReason;
}

/**
 * Closes a stream exactly once, kind-aware. The guarded UPDATE (`WHERE state='open'`)
 * in `markStreamClosed` is the lock and the idempotency gate: a stream already closed
 * by the other path (append-time declared close vs the job-terminated timeout sweep)
 * returns null, so no duplicate `LOG_STREAM_CLOSED` is written and no second tombstone
 * lands. `truncated` is set on the timeout path for both kinds. Then:
 *
 * - `log_stream`: a timeout close injects a `runner_lost` tombstone in-band (the
 *   `capped` tombstone, if any, was injected earlier at the append that tripped the cap).
 * - `agent_session`: no in-band tombstone ever. The `capped` flag is derived here from
 *   the per-job `job_accounting.capped_at` (a job-level signal; see `AttemptStream`).
 *
 * The event drives compaction; it is written in the same transaction as the flip and
 * carries the stream `kind` so consumers branch without a lookup.
 */
export async function closeStream(
  tx: Transaction,
  params: CloseStreamParams,
): Promise<AttemptStream | null> {
  const closed = await markStreamClosed(tx, {
    streamId: params.streamId,
    reason: params.reason,
    markTruncated: params.reason === 'timeout',
  });
  if (!closed) return null;

  let capped = closed.capped;
  if (closed.kind === 'agent_session') {
    if (await isJobCapped(tx, closed.jobId)) {
      await markStreamCapped(tx, closed.id);
      capped = true;
    }
  } else if (closed.kind === 'log_stream' && params.reason === 'timeout') {
    const tombstone = controlTombstone('runner_lost');
    await insertChunk(tx, {
      streamId: closed.id,
      streamOffset: closed.committedLength,
      byteLen: tombstone.length,
      data: tombstone,
      origin: 'control',
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
      kind: closed.kind,
    },
  });

  return capped === closed.capped ? closed : {...closed, capped};
}
