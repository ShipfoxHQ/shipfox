import type {LogOutcomeDto} from '@shipfox/api-workflows-dto';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {db} from '#db/db.js';
import {
  type AttemptStreamIdentity,
  getAttemptStreamByIdInTransaction,
  getOrCreateAttemptStreamWithStatus,
} from '#db/streams.js';
import {recordAppendedCount, streamClosedCount} from '#metrics/instance.js';
import {closeStream} from './close-stream.js';

export interface FinalizeAttemptLogStreamParams extends AttemptStreamIdentity {
  logOutcome: LogOutcomeDto;
}

interface FinalizeAttemptLogStreamResult {
  stream: AttemptStream;
  closedReason: 'declared' | 'timeout' | null;
}

export async function finalizeAttemptLogStream(
  params: FinalizeAttemptLogStreamParams,
): Promise<AttemptStream> {
  const result: FinalizeAttemptLogStreamResult = await db().transaction(async (tx) => {
    const {stream} = await getOrCreateAttemptStreamWithStatus(tx, params);
    if (stream.state === 'closed') return {stream, closedReason: null};

    const reason = params.logOutcome === 'abandoned' ? 'timeout' : 'declared';
    const closed = await closeStream(tx, {streamId: stream.id, reason});
    if (closed) return {stream: closed, closedReason: reason};

    const current = await getAttemptStreamByIdInTransaction(tx, stream.id);
    if (!current) throw new Error(`Log stream disappeared during finalization: ${stream.id}`);
    return {stream: current, closedReason: null};
  });

  if (result.closedReason) {
    if (result.closedReason === 'timeout') recordAppendedCount.add(1, {kind: 'runner_lost'});
    streamClosedCount.add(1, {reason: result.closedReason});
  }

  return result.stream;
}
