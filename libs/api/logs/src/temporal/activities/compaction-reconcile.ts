import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {config} from '#config.js';
import {listStaleUncompactedStreams} from '#db/streams.js';
import {LOGS_COMPACTION_TASK_QUEUE} from '#temporal/constants.js';

// Bounded per tick; remaining stale streams are picked up on the next cron run.
const RECONCILE_BATCH_LIMIT = 100;

/**
 * Backstop for the event-triggered path: finds closed streams that never got an object
 * key past the stale window and re-starts compaction for each. Starting by the same
 * `logs-compact:{streamId}` workflow id re-drives a stream whose bounded-retry run already
 * failed and closed, while skipping one whose run is still RUNNING (AlreadyStarted). Starts
 * independent workflows, not children, so a re-driven run is not tied to this cron tick.
 *
 * One stream's unexpected start failure is logged and skipped, never thrown: a single poison
 * stream must not abort the batch and leave the rest of the backlog un-re-driven (the next
 * tick retries it). The activity only fails on the initial DB query.
 */
export async function compactionReconcileActivity(): Promise<{restarted: number; failed: number}> {
  const stale = await listStaleUncompactedStreams({
    olderThanSeconds: config.LOG_COMPACTION_RECONCILE_STALE_SECONDS,
    limit: RECONCILE_BATCH_LIMIT,
  });

  let restarted = 0;
  let failed = 0;
  for (const stream of stale) {
    try {
      await temporalClient().workflow.start('compactStream', {
        taskQueue: LOGS_COMPACTION_TASK_QUEUE,
        workflowId: `logs-compact:${stream.id}`,
        args: [{streamId: stream.id}],
      });
      restarted += 1;
    } catch (error) {
      if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') continue;
      failed += 1;
      logger().error(
        {err: error, streamId: stream.id},
        'Failed to re-drive stale stream compaction',
      );
    }
  }

  return {restarted, failed};
}
