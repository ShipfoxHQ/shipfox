import type {Buffer} from 'node:buffer';
import {
  parseAppendableLogRecordLine,
  parseLogRecordLine,
  parseSessionLine,
  type StreamKind,
} from '@shipfox/api-logs-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {accrueStoredBytes, claimCap, ensureJobAccounting, isJobCapped} from '#db/accounting.js';
import {insertChunk} from '#db/chunks.js';
import {db, type Transaction} from '#db/db.js';
import {
  casExtendCommittedLength,
  getAttemptStream,
  getOrCreateAttemptStream,
  setDeclaredTotalBytes,
} from '#db/streams.js';
import {allowedBudget} from './budget.js';
import {closeStream, controlTombstone} from './close-stream.js';
import {MalformedLogChunkError, OffsetGapError} from './errors.js';

export interface AppendLogsParams {
  jobId: string;
  workspaceId: string;
  projectId: string;
  runId: string;
  stepId: string;
  attempt: number;
  kind: StreamKind;
  offset: number;
  body: Buffer;
}

export interface AppendLogsResult {
  committedLength: number;
  capped: boolean;
}

interface ParsedBody {
  declaredTotalBytes?: number;
}

/** Fatally decodes a body as UTF-8 so invalid bytes are rejected rather than replaced. */
function decodeUtf8Fatal(body: Buffer, message: string): string {
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(body);
  } catch {
    throw new MalformedLogChunkError(message);
  }
}

/**
 * Pure pre-transaction parse, dispatched by stream kind. Both kinds require whole,
 * newline-terminated lines so `committed_length` always lands on a line boundary
 * (one body = one chunk = whole lines; no line ever spans two chunks). Runs before
 * any lock is taken, so a malformed or large body never holds a row. The budget
 * charges the raw stored byte length, not a decoded sum, so no per-record byte
 * counting happens here.
 *
 * - `log_stream`: each line is validated against the appendable union (a forged
 *   server-only `capped`/`runner_lost` fails here); the declared total is pulled
 *   from an `end` record. A line that is a valid server-only record under the read
 *   union surfaces its type via `forgedType` for the narrowed audit warn.
 * - `agent_session`: the whole body is decoded with fatal UTF-8 (so the stored
 *   verbatim bytes are guaranteed valid UTF-8 JSONL), then each line must parse as
 *   JSON within the configured line cap. The bytes are never interpreted as control.
 */
function parseAppendBody(body: Buffer, kind: StreamKind): ParsedBody {
  if (body.length === 0) return {};

  if (kind === 'agent_session') {
    const text = decodeUtf8Fatal(body, 'agent_session body is not valid UTF-8');
    if (!text.endsWith('\n')) {
      throw new MalformedLogChunkError('append body must end with a newline (whole records only)');
    }
    const lines = text.split('\n');
    lines.pop();
    for (const line of lines) {
      try {
        parseSessionLine(line, config.LOG_MAX_SESSION_LINE_BYTES);
      } catch {
        throw new MalformedLogChunkError(
          'agent_session body contains an invalid or oversized JSON line',
        );
      }
    }
    return {};
  }

  const text = body.toString('utf8');
  if (!text.endsWith('\n')) {
    throw new MalformedLogChunkError('append body must end with a newline (whole records only)');
  }
  const lines = text.split('\n');
  lines.pop();

  let declaredTotalBytes: number | undefined;
  for (const line of lines) {
    let record: ReturnType<typeof parseAppendableLogRecordLine>;
    try {
      record = parseAppendableLogRecordLine(line);
    } catch {
      throw new MalformedLogChunkError(
        'append body contains an invalid NDJSON record',
        detectForgedType(line),
      );
    }
    if (record.type === 'end') {
      declaredTotalBytes = record.total_bytes;
    }
  }

  return declaredTotalBytes === undefined ? {} : {declaredTotalBytes};
}

/**
 * A line that fails the appendable union but is a valid record under the read union
 * can only be a server-only `capped`/`runner_lost` tombstone — i.e. a forgery
 * attempt. Returns its type for the audit warn, or undefined for plain garbage.
 */
function detectForgedType(line: string): string | undefined {
  try {
    return parseLogRecordLine(line).type;
  } catch {
    return undefined;
  }
}

/**
 * Empty-body heartbeat: report the current committed length without materializing
 * a stream, so a runner cannot mint unbounded rows with empty appends.
 */
async function readHeartbeat(tx: Transaction, params: AppendLogsParams): Promise<AppendLogsResult> {
  const existing = await getAttemptStream(tx, {
    jobId: params.jobId,
    stepId: params.stepId,
    attempt: params.attempt,
    kind: params.kind,
  });
  return {
    committedLength: existing?.committedLength ?? 0,
    capped: await isJobCapped(tx, params.jobId),
  };
}

interface StoreChunkParams {
  params: AppendLogsParams;
  streamId: string;
  byteLen: number;
  committedLength: number;
  declaredTotalBytes: number | undefined;
}

interface StoreChunkResult extends AppendLogsResult {
  /**
   * Whether the runner chunk was persisted. False only when the job was already
   * capped and the body (including any `end` record) was dropped, so the stream is
   * not whole and must not be declared-closed.
   */
  stored: boolean;
}

/**
 * Accrues the stored bytes, persists the chunk, and trips the per-job cap when
 * this append crosses the budget. Runs only after the offset-CAS extended
 * `committed_length`, so the committed length already reflects the accepted bytes.
 */
async function storeChunk(
  tx: Transaction,
  {params, streamId, byteLen, committedLength, declaredTotalBytes}: StoreChunkParams,
): Promise<StoreChunkResult> {
  await ensureJobAccounting(tx, {jobId: params.jobId, workspaceId: params.workspaceId});
  const accrued = await accrueStoredBytes(tx, {jobId: params.jobId, delta: byteLen});

  // Already capped: accept-and-drop. committed_length has advanced so the runner
  // drains its spool cleanly instead of retry-looping; nothing is stored.
  if (!accrued) return {committedLength, capped: true, stored: false};

  await insertChunk(tx, {
    streamId,
    streamOffset: params.offset,
    byteLen,
    data: params.body,
    origin: 'runner',
  });
  if (declaredTotalBytes !== undefined) {
    await setDeclaredTotalBytes(tx, {streamId, declaredTotalBytes});
  }

  const allowed = allowedBudget({
    baseBytes: config.LOG_BUDGET_BASE_BYTES,
    ratePerMinuteBytes: config.LOG_BUDGET_RATE_BYTES_PER_MINUTE,
    elapsedMs: Date.now() - accrued.startedAt.getTime(),
  });
  if (accrued.used <= allowed) return {committedLength, capped: false, stored: true};

  // Over budget. No hard ceiling: this crossing append is stored in full (overshoot
  // bounded by one body). Claim the cap once. For log_stream, inject an in-band
  // `capped` tombstone for the winner; for agent_session, inject NOTHING — a control
  // record spliced into the verbatim JSONL would corrupt it, so the capped signal is
  // the row flag set at close (derived from job_accounting.capped_at) instead.
  const won = await claimCap(tx, params.jobId);
  if (won && params.kind === 'log_stream') {
    const tombstone = controlTombstone('capped');
    await insertChunk(tx, {
      streamId,
      streamOffset: committedLength,
      byteLen: tombstone.length,
      data: tombstone,
      origin: 'control',
    });
  }
  return {committedLength, capped: true, stored: true};
}

/**
 * Appends one chunk of framed bytes for a `(job, step, attempt, kind)` stream under
 * the offset-CAS protocol, enforcing the per-job accrual budget. Concurrency is
 * serialized through Postgres row locks taken implicitly by the conditional
 * UPDATEs (no explicit `SELECT ... FOR UPDATE`); appends for one job contend on
 * its single accounting row, so the path is multi-instance safe but not lock-free.
 */
export async function appendLogs(params: AppendLogsParams): Promise<AppendLogsResult> {
  let parsed: ParsedBody;
  try {
    parsed = parseAppendBody(params.body, params.kind);
  } catch (error) {
    // Narrowed audit: only the detectable forgery case, never the payload or a token.
    if (error instanceof MalformedLogChunkError && error.forgedType !== undefined) {
      logger().warn(
        {
          jobId: params.jobId,
          stepId: params.stepId,
          kind: params.kind,
          offendingType: error.forgedType,
        },
        'Rejected forged server-only log record on append',
      );
    }
    throw error;
  }
  const {declaredTotalBytes} = parsed;
  const byteLen = params.body.length;

  return await db().transaction(async (tx) => {
    if (byteLen === 0) return readHeartbeat(tx, params);

    const stream = await getOrCreateAttemptStream(tx, {
      jobId: params.jobId,
      stepId: params.stepId,
      attempt: params.attempt,
      kind: params.kind,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      runId: params.runId,
    });

    // Closed stream (the runner's end already landed, or the job-terminated sweep ran):
    // accept-and-drop so a late chunk can never race compaction. committed_length is
    // frozen at close, so this reports the final offset and the runner stops cleanly.
    if (stream.state === 'closed') {
      return {committedLength: stream.committedLength, capped: await isJobCapped(tx, params.jobId)};
    }

    const cas = await casExtendCommittedLength(tx, {
      streamId: stream.id,
      offset: params.offset,
      byteLen,
    });
    if (cas.outcome === 'gap') throw new OffsetGapError(cas.committedLength);
    if (cas.outcome === 'retry') {
      return {committedLength: cas.committedLength, capped: await isJobCapped(tx, params.jobId)};
    }

    const {stored, ...result} = await storeChunk(tx, {
      params,
      streamId: stream.id,
      byteLen,
      committedLength: cas.committedLength,
      declaredTotalBytes,
    });

    // The runner's end record was committed in this append (offset-CAS guarantees
    // everything before it is already committed), so the stream is whole. Declared-close
    // it in-band so compaction starts at once instead of waiting for the timeout sweep.
    // Only when the chunk was actually stored: an end body dropped because the job was
    // already capped persists nothing, so the stream is not whole and stays open for the
    // timeout sweep to close it as truncated. agent_session never carries an `end`, so
    // it is always closed by the sweep.
    if (declaredTotalBytes !== undefined && stored) {
      await closeStream(tx, {streamId: stream.id, reason: 'declared'});
    }

    return result;
  });
}
