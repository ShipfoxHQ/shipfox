import {createHmac} from 'node:crypto';
import {config} from '@shipfox/e2e-core';

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
