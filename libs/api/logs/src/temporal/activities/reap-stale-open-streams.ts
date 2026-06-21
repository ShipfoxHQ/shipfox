import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {closeStream} from '#core/close-stream.js';
import {db} from '#db/db.js';
import {listStaleOpenStreams} from '#db/streams.js';

// Bounded per tick; remaining stale streams are picked up on the next cron run.
const REAP_BATCH_LIMIT = 100;

/**
 * Re-drives open streams missed by the one-shot job-terminal close. Each stream
 * closes in its own transaction through `closeStream`, so races are idempotent
 * and one failed row does not block the rest of the batch.
 */
export async function reapStaleOpenStreamsActivity(): Promise<{reaped: number; failed: number}> {
  const stale = await listStaleOpenStreams({
    olderThanSeconds: config.LOG_STREAM_REAP_AFTER_SECONDS,
    limit: REAP_BATCH_LIMIT,
  });

  let reaped = 0;
  let failed = 0;
  for (const stream of stale) {
    try {
      const closed = await db().transaction((tx) =>
        closeStream(tx, {streamId: stream.id, reason: 'timeout'}),
      );
      if (closed) reaped += 1;
    } catch (error) {
      failed += 1;
      logger().error({err: error, streamId: stream.id}, 'Failed to reap stale open log stream');
    }
  }

  return {reaped, failed};
}
