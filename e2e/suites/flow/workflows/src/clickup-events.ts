import {PollTimeoutError} from '@shipfox/e2e-core';
import {postClickUpCommentDelivery} from '@shipfox/e2e-driver-clickup';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';

const MAX_TRIGGER_ATTEMPTS = 8;
const RUN_LOOKUP_TIMEOUT_MS = 15_000;

export async function triggerClickUpCommentAndAwaitRun(params: {
  projectId: string;
  workspaceId: string;
  token: string;
  webhookSecret: string;
  webhookId: string;
  connectionId: string;
  taskId: string;
  actorId: string;
  commentText: string;
}): Promise<{runId: string; deliveryId: string}> {
  const deliveryIds: string[] = [];
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_TRIGGER_ATTEMPTS; attempt += 1) {
    const historyItemId = `history-${crypto.randomUUID().replaceAll('-', '')}`;
    const deliveryId = await postClickUpCommentDelivery({
      webhookSecret: params.webhookSecret,
      webhookId: params.webhookId,
      connectionId: params.connectionId,
      taskId: params.taskId,
      historyItemId,
      actorId: params.actorId,
      commentText: params.commentText,
    });
    deliveryIds.push(deliveryId);

    let run: Awaited<ReturnType<typeof waitForRunByDeliveryId>>;
    try {
      run = await waitForRunByDeliveryId({
        projectId: params.projectId,
        deliveryId,
        token: params.token,
        timeoutMs: RUN_LOOKUP_TIMEOUT_MS,
        workspaceId: params.workspaceId,
      });
    } catch (error) {
      lastError = error;
      continue;
    }

    await assertNoEarlierClickUpRuns({
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      token: params.token,
      deliveryIds: deliveryIds.slice(0, -1),
    });
    return {runId: run.id, deliveryId};
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`No run appeared after ${MAX_TRIGGER_ATTEMPTS} signed ClickUp deliveries.`);
}

async function assertNoEarlierClickUpRuns(params: {
  projectId: string;
  workspaceId: string;
  token: string;
  deliveryIds: string[];
}): Promise<void> {
  for (const deliveryId of params.deliveryIds) {
    try {
      const run = await waitForRunByDeliveryId({
        projectId: params.projectId,
        deliveryId,
        token: params.token,
        timeoutMs: RUN_LOOKUP_TIMEOUT_MS,
        workspaceId: params.workspaceId,
      });
      throw new Error(
        `ClickUp delivery ${deliveryId} also started workflow run ${run.id}; expected one run for the logical trigger.`,
      );
    } catch (error) {
      if (error instanceof PollTimeoutError) continue;
      throw error;
    }
  }
}
