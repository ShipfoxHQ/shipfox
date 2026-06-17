import {Buffer} from 'node:buffer';
import {type LogRecord, parseLogRecordLine} from '@shipfox/api-log-ingest-dto';
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
import {MalformedLogChunkError, OffsetGapError} from './errors.js';

export interface AppendLogsParams {
  jobId: string;
  workspaceId: string;
  stepId: string;
  attempt: number;
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

/**
 * Pure pre-transaction parse: validates the body is whole, newline-terminated v1
 * records and pulls out the declared total from an `end` record. The budget
 * charges the raw stored byte length, not a decoded sum, so no per-record byte
 * counting happens here. Runs before any lock is taken, so a malformed or large
 * body never holds a row.
 */
function parseAppendBody(body: Buffer): ParsedBody {
  const text = body.toString('utf8');
  if (text.length === 0) return {};
  if (!text.endsWith('\n')) {
    throw new MalformedLogChunkError('append body must end with a newline (whole records only)');
  }

  const lines = text.split('\n');
  lines.pop(); // the trailing '' after the final newline

  let declaredTotalBytes: number | undefined;
  for (const line of lines) {
    let record: ReturnType<typeof parseLogRecordLine>;
    try {
      record = parseLogRecordLine(line);
    } catch {
      throw new MalformedLogChunkError('append body contains an invalid NDJSON record');
    }
    if (record.type === 'control' && record.kind === 'end') {
      declaredTotalBytes = record.total_bytes;
    }
  }

  return declaredTotalBytes === undefined ? {} : {declaredTotalBytes};
}

function cappedTombstone(): Buffer {
  // Typed against the shared v1 contract so an envelope change in the dto package
  // breaks this at compile time rather than silently emitting an off-contract record.
  const record: LogRecord = {v: 1, ts: Date.now(), src: 'system', type: 'control', kind: 'capped'};
  return Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
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

/**
 * Accrues the stored bytes, persists the chunk, and trips the per-job cap when
 * this append crosses the budget. Runs only after the offset-CAS extended
 * `committed_length`, so the committed length already reflects the accepted bytes.
 */
async function storeChunk(
  tx: Transaction,
  {params, streamId, byteLen, committedLength, declaredTotalBytes}: StoreChunkParams,
): Promise<AppendLogsResult> {
  await ensureJobAccounting(tx, {jobId: params.jobId, workspaceId: params.workspaceId});
  const accrued = await accrueStoredBytes(tx, {jobId: params.jobId, delta: byteLen});

  // Already capped: accept-and-drop. committed_length has advanced so the runner
  // drains its spool cleanly instead of retry-looping; nothing is stored.
  if (!accrued) return {committedLength, capped: true};

  await insertChunk(tx, {
    streamId,
    streamOffset: params.offset,
    byteLen,
    data: params.body,
    kind: 'runner',
  });
  if (declaredTotalBytes !== undefined) {
    await setDeclaredTotalBytes(tx, {streamId, declaredTotalBytes});
  }

  const allowed = allowedBudget({
    baseBytes: config.LOG_BUDGET_BASE_BYTES,
    ratePerMinuteBytes: config.LOG_BUDGET_RATE_BYTES_PER_MINUTE,
    elapsedMs: Date.now() - accrued.startedAt.getTime(),
  });
  if (accrued.used <= allowed) return {committedLength, capped: false};

  // Over budget. No hard ceiling: this crossing append is stored in full (overshoot
  // bounded by one body). Claim the cap once and inject the tombstone for the winner.
  const won = await claimCap(tx, params.jobId);
  if (won) {
    const tombstone = cappedTombstone();
    await insertChunk(tx, {
      streamId,
      streamOffset: committedLength,
      byteLen: tombstone.length,
      data: tombstone,
      kind: 'control',
    });
  }
  return {committedLength, capped: true};
}

/**
 * Appends one chunk of framed NDJSON for a `(job, step, attempt)` stream under the
 * offset-CAS protocol, enforcing the per-job accrual budget. Concurrency is
 * serialized through Postgres row locks taken implicitly by the conditional
 * UPDATEs (no explicit `SELECT ... FOR UPDATE`); appends for one job contend on
 * its single accounting row, so the path is multi-instance safe but not lock-free.
 */
export async function appendLogs(params: AppendLogsParams): Promise<AppendLogsResult> {
  const {declaredTotalBytes} = parseAppendBody(params.body);
  const byteLen = params.body.length;

  return await db().transaction(async (tx) => {
    if (byteLen === 0) return readHeartbeat(tx, params);

    const stream = await getOrCreateAttemptStream(tx, {
      jobId: params.jobId,
      stepId: params.stepId,
      attempt: params.attempt,
      workspaceId: params.workspaceId,
    });

    const cas = await casExtendCommittedLength(tx, {
      streamId: stream.id,
      offset: params.offset,
      byteLen,
    });
    if (cas.outcome === 'gap') throw new OffsetGapError(cas.committedLength);
    if (cas.outcome === 'retry') {
      return {committedLength: cas.committedLength, capped: await isJobCapped(tx, params.jobId)};
    }

    return storeChunk(tx, {
      params,
      streamId: stream.id,
      byteLen,
      committedLength: cas.committedLength,
      declaredTotalBytes,
    });
  });
}
