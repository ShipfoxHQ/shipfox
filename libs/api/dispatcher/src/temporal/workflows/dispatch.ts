import {continueAsNew, proxyActivities, sleep} from '@temporalio/workflow';
import {DISPATCHER_WORKER_COUNT} from '#core/constants.js';
import type {createActivities} from '../activities/index.js';

const {drainAndDispatch} = proxyActivities<ReturnType<typeof createActivities>>({
  startToCloseTimeout: '60s',
});

const {pruneOutboxRetention} = proxyActivities<ReturnType<typeof createActivities>>({
  startToCloseTimeout: '5m',
});

export interface OutboxDispatcherWorkflowParams {
  workerIndex: number;
  workerCount: number;
}

export async function outboxDispatcherWorkflow(
  params: OutboxDispatcherWorkflowParams = {workerIndex: 0, workerCount: DISPATCHER_WORKER_COUNT},
): Promise<void> {
  const currentParams = currentDispatcherParams(params);
  if (!currentParams) return;

  let hasMore = false;
  do {
    hasMore = await drainAndDispatch(currentParams);
  } while (hasMore);
  await sleep(POLL_INTERVAL);
  await continueAsNew<typeof outboxDispatcherWorkflow>(currentParams);
}

export async function outboxRetentionWorkflow(): Promise<void> {
  await pruneOutboxRetention();
}

const POLL_INTERVAL = '250ms';

function currentDispatcherParams(
  params: OutboxDispatcherWorkflowParams,
): OutboxDispatcherWorkflowParams | undefined {
  if (params.workerIndex >= DISPATCHER_WORKER_COUNT) return undefined;
  return {workerIndex: params.workerIndex, workerCount: DISPATCHER_WORKER_COUNT};
}
