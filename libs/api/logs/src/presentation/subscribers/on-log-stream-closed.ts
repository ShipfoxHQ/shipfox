import type {LogStreamClosedEvent} from '@shipfox/api-logs-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {LOGS_COMPACTION_TASK_QUEUE} from '#temporal/constants.js';

/**
 * A stream reached `closed` (declared end or timeout sweep). Start its compaction workflow
 * and return; no S3 work runs in the dispatcher. Deduped by `logs-compact:{streamId}`, so a
 * redelivered event is a no-op. A start that fails for any other reason is left to the
 * reconcile cron, which re-drives any closed-but-uncompacted stream.
 */
export async function onLogStreamClosed(payload: LogStreamClosedEvent): Promise<void> {
  try {
    await temporalClient().workflow.start('compactStream', {
      taskQueue: LOGS_COMPACTION_TASK_QUEUE,
      workflowId: `logs-compact:${payload.streamId}`,
      args: [{streamId: payload.streamId}],
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') {
      logger().debug({streamId: payload.streamId}, 'Compaction workflow already started');
      return;
    }
    throw error;
  }
}
