import {config} from '#config.js';
import {
  type ReapStaleOpenStreamsResult,
  reapStaleOpenStreams,
} from '#core/reap-stale-open-streams.js';
import {REAP_BATCH_LIMIT} from '#temporal/constants.js';

/** Cron-driven backstop that force-closes open streams the one-shot job-terminal close missed. */
export function reapStaleOpenStreamsActivity(): Promise<ReapStaleOpenStreamsResult> {
  return reapStaleOpenStreams({
    olderThanSeconds: config.LOG_STREAM_REAP_AFTER_SECONDS,
    batchLimit: REAP_BATCH_LIMIT,
  });
}
