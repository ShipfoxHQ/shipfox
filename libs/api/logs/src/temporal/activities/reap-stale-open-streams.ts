import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {closeStream} from '#core/close-stream.js';
import {db} from '#db/db.js';
import {listStaleOpenStreams} from '#db/streams.js';

// Bounded per tick; remaining stale streams are picked up on the next cron run.
const REAP_BATCH_LIMIT = 100;

/**
 * Backstop for the one-shot job-terminated sweep. That sweep snapshots a job's open streams
 * once, so a stream whose first append lands after it ran is never closed and leaks: open
 * streams are invisible to compaction and retention (both keyed on `state = 'closed'`). This
 * cron force-closes any stream left open past the lease window, re-entering it into the
 * closed -> compact -> retention lifecycle.
 *
 * Each stream closes in its own transaction through the guarded `closeStream`, so a declared-
 * or timeout-close that already won is skipped (returns null) instead of writing a duplicate
 * event or tombstone; this also makes a tick that overlaps its own retry idempotent. One
 * stream's close failure is logged and skipped, never thrown, so a single poison row cannot
 * abort the batch and stall the backlog (the next tick retries it). The activity only fails on
 * the initial DB query.
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
