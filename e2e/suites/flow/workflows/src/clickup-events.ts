import {createHmac} from 'node:crypto';
import {config, PollTimeoutError} from '@shipfox/e2e-core';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';

const MAX_TRIGGER_ATTEMPTS = 8;
const RUN_LOOKUP_TIMEOUT_MS = 5_000;

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

    try {
      const run = await waitForRunByDeliveryId({
        projectId: params.projectId,
        deliveryId,
        token: params.token,
        timeoutMs: RUN_LOOKUP_TIMEOUT_MS,
        workspaceId: params.workspaceId,
      });
      return {runId: run.id, deliveryId};
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`No run appeared after ${MAX_TRIGGER_ATTEMPTS} signed ClickUp deliveries.`);
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

export async function expectNoClickUpRun(params: {
  projectId: string;
  workspaceId: string;
  token: string;
  deliveryId: string;
}): Promise<void> {
  try {
    await waitForRunByDeliveryId({
      projectId: params.projectId,
      deliveryId: params.deliveryId,
      token: params.token,
      timeoutMs: 2_000,
      workspaceId: params.workspaceId,
    });
  } catch (error) {
    if (error instanceof PollTimeoutError) return;
    throw error;
  }
  throw new Error(`Expected ClickUp delivery ${params.deliveryId} not to start a run.`);
}
