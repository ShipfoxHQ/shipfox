import {logger} from '@shipfox/node-opentelemetry';
import {db} from '#db/db.js';
import {listStaleOpenStreams} from '#db/streams.js';
import {recordAppendedCount, streamClosedCount} from '#metrics/instance.js';
import {closeStream} from './close-stream.js';

export interface ReapStaleOpenStreamsResult {
  /** Streams force-closed by this run. */
  reaped: number;
  /** Streams whose guarded close threw; logged, skipped, retried next run. */
  failed: number;
}

export interface ReapStaleOpenStreamsParams {
  /**
   * A stream open longer than this since `created_at` can no longer be appended to: its job
   * holds one lease minted at-or-before the stream's creation, so once the lease TTL has
   * elapsed no append can land and the close is safe. Set above `AUTH_JOB_LEASE_TOKEN_EXPIRES_IN`.
   */
  olderThanSeconds: number;
  batchLimit: number;
}

/**
 * Force-closes open streams the one-shot job-terminal sweep missed: a stream whose first append
 * landed after that sweep's snapshot would otherwise stay `open` forever, invisible to
 * compaction and retention (both partial on `state = 'closed'`). Reusing the guarded
 * `closeStream` re-drives each into the normal closed -> compact -> retention lifecycle.
 *
 * Each row closes in its own transaction, so a tick/retry overlap is idempotent (the guarded
 * `markStreamClosed` lets only one close win) and one failed row is logged and skipped instead
 * of aborting the batch.
 */
export async function reapStaleOpenStreams(
  params: ReapStaleOpenStreamsParams,
): Promise<ReapStaleOpenStreamsResult> {
  const stale = await listStaleOpenStreams({
    olderThanSeconds: params.olderThanSeconds,
    limit: params.batchLimit,
  });

  const result: ReapStaleOpenStreamsResult = {reaped: 0, failed: 0};
  for (const stream of stale) {
    try {
      const closed = await db().transaction((tx) =>
        closeStream(tx, {streamId: stream.id, reason: 'timeout'}),
      );
      if (closed) {
        result.reaped += 1;
        recordAppendedCount.add(1, {kind: 'runner_lost'});
        streamClosedCount.add(1, {reason: 'timeout'});
      }
    } catch (error) {
      result.failed += 1;
      logger().error({err: error, streamId: stream.id}, 'Failed to reap stale open log stream');
    }
  }

  return result;
}
