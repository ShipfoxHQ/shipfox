import {Buffer} from 'node:buffer';
import {parseLogRecordLine} from '@shipfox/api-log-ingest-dto';
import {config} from '#config.js';
import {accruePayloadBytes, claimCap, ensureJobAccounting, isJobCapped} from '#db/accounting.js';
import {insertChunk} from '#db/chunks.js';
import {db} from '#db/db.js';
import {
  casExtendCommittedLength,
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
  payloadDelta: number;
  declaredTotalBytes?: number;
}

/**
 * Pure pre-transaction parse: validates the body is whole, newline-terminated v1
 * records and sums the decoded `data` payload bytes (output records only). This
 * runs before any lock is taken, so a malformed or large body never holds a row.
 */
function parseAppendBody(body: Buffer): ParsedBody {
  const text = body.toString('utf8');
  if (text.length === 0) return {payloadDelta: 0};
  if (!text.endsWith('\n')) {
    throw new MalformedLogChunkError('append body must end with a newline (whole records only)');
  }

  const lines = text.split('\n');
  lines.pop(); // the trailing '' after the final newline

  let payloadDelta = 0;
  let declaredTotalBytes: number | undefined;
  for (const line of lines) {
    let record: ReturnType<typeof parseLogRecordLine>;
    try {
      record = parseLogRecordLine(line);
    } catch {
      throw new MalformedLogChunkError('append body contains an invalid NDJSON record');
    }
    if (record.type === 'output') {
      payloadDelta += Buffer.byteLength(record.data, 'utf8');
    } else if (record.kind === 'end') {
      declaredTotalBytes = record.total_bytes;
    }
  }

  return declaredTotalBytes === undefined ? {payloadDelta} : {payloadDelta, declaredTotalBytes};
}

function cappedTombstone(): Buffer {
  const record = {v: 1, ts: Date.now(), src: 'system', type: 'control', kind: 'capped'};
  return Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Appends one chunk of framed NDJSON for a `(job, step, attempt)` stream under the
 * offset-CAS protocol, enforcing the per-job accrual budget. Lock-free: every
 * write is an atomic conditional UPDATE, so concurrent and multi-instance appends
 * serialize through Postgres with no explicit row locks.
 */
export async function appendLogs(params: AppendLogsParams): Promise<AppendLogsResult> {
  const parsed = parseAppendBody(params.body);
  const byteLen = params.body.length;

  return await db().transaction(async (tx) => {
    const stream = await getOrCreateAttemptStream(tx, {
      jobId: params.jobId,
      stepId: params.stepId,
      attempt: params.attempt,
      workspaceId: params.workspaceId,
    });

    if (byteLen === 0) {
      return {
        committedLength: stream.committedLength,
        capped: await isJobCapped(tx, params.jobId),
      };
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

    const committedLength = cas.committedLength;
    await ensureJobAccounting(tx, {jobId: params.jobId, workspaceId: params.workspaceId});
    const accrued = await accruePayloadBytes(tx, {jobId: params.jobId, delta: parsed.payloadDelta});

    // Already capped: accept-and-drop. committed_length has advanced so the runner
    // drains its spool cleanly instead of retry-looping; nothing is stored.
    if (!accrued) return {committedLength, capped: true};

    await insertChunk(tx, {
      streamId: stream.id,
      streamOffset: params.offset,
      byteLen,
      data: params.body,
      kind: 'runner',
    });
    if (parsed.declaredTotalBytes !== undefined) {
      await setDeclaredTotalBytes(tx, {
        streamId: stream.id,
        declaredTotalBytes: parsed.declaredTotalBytes,
      });
    }

    const allowed = allowedBudget({
      baseBytes: config.LOG_BUDGET_BASE_BYTES,
      ratePerMinuteBytes: config.LOG_BUDGET_RATE_BYTES_PER_MINUTE,
      elapsedMs: Date.now() - accrued.startedAt.getTime(),
    });

    if (accrued.used > allowed) {
      // No hard ceiling: this crossing append is stored in full (overshoot bounded
      // by one body). Claim the cap once and inject the tombstone for the winner.
      const won = await claimCap(tx, params.jobId);
      if (won) {
        const tombstone = cappedTombstone();
        await insertChunk(tx, {
          streamId: stream.id,
          streamOffset: committedLength,
          byteLen: tombstone.length,
          data: tombstone,
          kind: 'control',
        });
      }
      return {committedLength, capped: true};
    }

    return {committedLength, capped: false};
  });
}
