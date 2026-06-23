import {closeStream} from '#core/close-stream.js';
import {db} from '#db/db.js';
import {listOpenStreamsByJob} from '#db/streams.js';
import {recordAppendedCount, streamClosedCount} from '#metrics/instance.js';

/**
 * Job termination does not guarantee the runner flushed an end record: it may have
 * died, been capped, or lost its spool. Each stream closes in its own transaction
 * through the guarded `closeStream`, so a declared-close race is skipped instead of
 * writing a duplicate event or tombstone.
 */
export async function closeAbandonedStreamsActivity(params: {
  jobId: string;
}): Promise<{closed: number}> {
  const open = await listOpenStreamsByJob(params.jobId);

  let closed = 0;
  for (const stream of open) {
    const result = await db().transaction((tx) =>
      closeStream(tx, {streamId: stream.id, reason: 'timeout'}),
    );
    if (result) {
      closed += 1;
      recordAppendedCount.add(1, {kind: 'runner_lost'});
      streamClosedCount.add(1, {reason: 'timeout'});
    }
  }

  return {closed};
}
