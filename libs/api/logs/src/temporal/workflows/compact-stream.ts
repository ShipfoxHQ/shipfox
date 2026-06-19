import {log, proxyActivities} from '@temporalio/workflow';
import type {createLogsActivities} from '../activities/index.js';

// Bounded generous retry (not unlimited): a never-finishing RUNNING workflow would reject
// the reconcile cron's restart of the same workflow id. After the attempts are spent the
// run fails and closes, so the cron can re-drive it.
const {compactStreamActivity} = proxyActivities<ReturnType<typeof createLogsActivities>>({
  startToCloseTimeout: '1 hour',
  heartbeatTimeout: '2 minutes',
  retry: {
    initialInterval: '10 seconds',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 12,
  },
});

export interface CompactStreamInput {
  streamId: string;
}

/** Started per closed stream (deduped by `logs-compact:{streamId}`) by the closed-event subscriber and the reconcile cron. */
export async function compactStream(input: CompactStreamInput): Promise<void> {
  const result = await compactStreamActivity({streamId: input.streamId});
  log.info('Compacted log stream', {streamId: input.streamId, ...result});
}
