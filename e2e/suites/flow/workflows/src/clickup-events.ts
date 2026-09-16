import {createHmac} from 'node:crypto';
import {config, PollTimeoutError} from '@shipfox/e2e-core';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';

const MAX_TRIGGER_ATTEMPTS = 8;
const RUN_LOOKUP_TIMEOUT_MS = 15_000;

export function signClickUpHeaders(rawBody: string, webhookSecret: string): Record<string, string> {
  return {
    'x-signature': createHmac('sha256', webhookSecret).update(rawBody).digest('hex'),
  };
}

export function buildTaskCommentPostedEnvelope(params: {
  webhookId: string;
  taskId: string;
  historyItemId: string;
  actorId: string;
  commentText: string;
}) {
  const date = String(Date.now());
  const actor = {
    id: params.actorId,
    username: 'e2e-clickup-user',
    email: 'clickup-e2e@example.test',
    initials: 'EU',
  };

  return {
    event: 'taskCommentPosted' as const,
    webhook_id: params.webhookId,
    task_id: params.taskId,
    history_items: [
      {
        id: params.historyItemId,
        type: 'comment',
        date,
        field: 'comment',
        parent_id: 'e2e-clickup-list',
        data: {},
        source: {},
        user: actor,
        before: null,
        after: null,
        comment: {
          id: `comment-${params.historyItemId}`,
          text_content: params.commentText,
          comment: [],
          user: actor,
          assignee: null,
          assigned_by: null,
          date,
        },
      },
    ],
  };
}

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

export async function postClickUpCommentDelivery(params: {
  webhookSecret: string;
  webhookId: string;
  connectionId: string;
  taskId: string;
  historyItemId: string;
  actorId: string;
  commentText: string;
}): Promise<string> {
  const envelope = buildTaskCommentPostedEnvelope(params);
  const rawBody = JSON.stringify(envelope);
  const response = await fetch(
    new URL(`/webhooks/integrations/clickup/${params.connectionId}`, config.API_URL),
    {
      method: 'POST',
      body: rawBody,
      headers: {
        ...signClickUpHeaders(rawBody, params.webhookSecret),
        'content-type': 'application/json',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Signed ClickUp event delivery failed with ${response.status}.`);
  }
  return `${params.webhookId}:taskCommentPosted:${params.historyItemId}`;
}
