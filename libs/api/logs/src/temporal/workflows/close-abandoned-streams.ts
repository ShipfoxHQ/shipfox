import {log, proxyActivities, sleep} from '@temporalio/workflow';
import type {createLogsActivities} from '../activities/index.js';

const {closeAbandonedStreamsActivity} = proxyActivities<ReturnType<typeof createLogsActivities>>({
  startToCloseTimeout: '5 minutes',
});

export interface CloseAbandonedStreamsInput {
  jobId: string;
  graceSeconds: number;
}

/**
 * Started by the `WORKFLOWS_JOB_TERMINATED` subscriber, deduped per job. Waits out
 * the grace period (so a last in-flight append can land and the runner's own
 * declared close can win), then force-closes whatever is still open.
 */
export async function closeAbandonedStreams(input: CloseAbandonedStreamsInput): Promise<void> {
  await sleep(input.graceSeconds * 1000);

  const {closed} = await closeAbandonedStreamsActivity({jobId: input.jobId});
  if (closed > 0) {
    log.info('Force-closed abandoned log streams', {jobId: input.jobId, closed});
  }
}
