import type {LogOutcomeDto, StepAttemptTerminalCauseDto} from '@shipfox/api-workflows-dto';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {db, type Transaction} from '#db/db.js';
import {
  type AttemptStreamIdentity,
  getAttemptStreamByIdInTransaction,
  getOrCreateAttemptStreamWithStatus,
} from '#db/streams.js';
import {
  recordAppendedCount,
  type StreamClosedMetricReason,
  streamClosedCount,
} from '#metrics/instance.js';
import {closeStream} from './close-stream.js';

export interface FinalizeAttemptLogStreamParams extends AttemptStreamIdentity {
  logOutcome: LogOutcomeDto;
  terminalCause?: StepAttemptTerminalCauseDto | null | undefined;
}

interface FinalizeAttemptLogStreamResult {
  stream: AttemptStream;
  metricReason: StreamClosedMetricReason | null;
  tombstoneKind: StepAttemptTerminalCauseDto | null;
}

interface FinalizeMetrics {
  recordAppendedCount: {
    add: (value: number, attributes: {kind: StepAttemptTerminalCauseDto}) => void;
  };
  streamClosedCount: {
    add: (value: number, attributes: {reason: StreamClosedMetricReason}) => void;
  };
}

const defaultMetrics: FinalizeMetrics = {
  recordAppendedCount,
  streamClosedCount,
};

export function createFinalizeAttemptLogStream(metrics: FinalizeMetrics = defaultMetrics) {
  return async (params: FinalizeAttemptLogStreamParams): Promise<AttemptStream> => {
    const result: FinalizeAttemptLogStreamResult = await db().transaction(async (tx) => {
      const {stream} = await getOrCreateAttemptStreamWithStatus(tx, params);
      if (stream.state === 'closed') return {stream, metricReason: null, tombstoneKind: null};
      return closeOpenAttemptStream(tx, stream, params);
    });

    if (result.tombstoneKind) {
      metrics.recordAppendedCount.add(1, {kind: result.tombstoneKind});
    }
    if (result.metricReason) {
      metrics.streamClosedCount.add(1, {reason: result.metricReason});
    }

    return result.stream;
  };
}

async function closeOpenAttemptStream(
  tx: Transaction,
  stream: AttemptStream,
  params: FinalizeAttemptLogStreamParams,
): Promise<FinalizeAttemptLogStreamResult> {
  const reason = params.logOutcome === 'abandoned' ? 'timeout' : 'declared';
  const terminalCause = params.logOutcome === 'abandoned' ? params.terminalCause : null;
  const closed = await closeStream(tx, {streamId: stream.id, reason, terminalCause});
  if (closed) {
    return {
      stream: closed,
      metricReason: metricReasonForClose(reason, terminalCause),
      tombstoneKind: terminalCause ?? null,
    };
  }

  const current = await getAttemptStreamByIdInTransaction(tx, stream.id);
  if (!current) throw new Error(`Log stream disappeared during finalization: ${stream.id}`);
  return {stream: current, metricReason: null, tombstoneKind: null};
}

function metricReasonForClose(
  reason: 'declared' | 'timeout',
  terminalCause: StepAttemptTerminalCauseDto | null | undefined,
): StreamClosedMetricReason {
  if (reason === 'declared') return 'declared';
  if (terminalCause === 'timed_out') return 'job_timeout';
  return terminalCause ?? 'abandoned';
}

export const finalizeAttemptLogStream = createFinalizeAttemptLogStream();
