import {createHmac} from 'node:crypto';
import {config} from '@shipfox/e2e-core';

export function signClickUpHeaders(rawBody: string, webhookSecret: string): Record<string, string> {
  return {
    'x-signature': createHmac('sha256', webhookSecret).update(rawBody).digest('hex'),
  };
}

function buildActor(actorId: string) {
  return {
    id: actorId,
    username: 'e2e-clickup-user',
    email: 'clickup-e2e@example.test',
    initials: 'EU',
  };
}

interface TaskChangeParams {
  webhookId: string;
  taskId: string;
  historyItemId: string;
  actorId: string;
  /** The List that holds the task. ClickUp sends it as each change record's `parent_id`. */
  listId: string;
}

function buildTaskChangeEnvelope({
  event,
  field,
  before,
  after,
  ...params
}: TaskChangeParams & {
  event: 'taskTagUpdated' | 'taskStatusUpdated';
  field: string;
  before: unknown;
  after: unknown;
}) {
  return {
    event,
    webhook_id: params.webhookId,
    task_id: params.taskId,
    history_items: [
      {
        id: params.historyItemId,
        type: 1,
        date: String(Date.now()),
        field,
        parent_id: params.listId,
        data: {},
        source: null,
        user: buildActor(params.actorId),
        before,
        after,
      },
    ],
  };
}

const tagOf = (name: string) => ({name, tag_fg: '#ffffff', tag_bg: '#000000'});

/**
 * A `taskTagUpdated` delivery. Each change record lists the tags the task has, so `tags` holds
 * every tag after the change and `previousTags` every tag before it.
 */
export function buildTaskTagUpdatedEnvelope({
  tags,
  previousTags = [],
  ...params
}: TaskChangeParams & {tags: readonly string[]; previousTags?: readonly string[]}) {
  return buildTaskChangeEnvelope({
    ...params,
    event: 'taskTagUpdated',
    field: 'tag',
    before: previousTags.map(tagOf),
    after: tags.map(tagOf),
  });
}

const statusOf = (status: string) => ({
  status,
  color: '#d3d3d3',
  type: 'custom',
  orderindex: 1,
});

/** A `taskStatusUpdated` delivery. ClickUp sends status names in lowercase. */
export function buildTaskStatusUpdatedEnvelope({
  status,
  previousStatus,
  ...params
}: TaskChangeParams & {status: string; previousStatus: string}) {
  return buildTaskChangeEnvelope({
    ...params,
    event: 'taskStatusUpdated',
    field: 'status',
    before: statusOf(previousStatus),
    after: statusOf(status),
  });
}

export function buildTaskCommentPostedEnvelope(params: {
  webhookId: string;
  taskId: string;
  historyItemId: string;
  actorId: string;
  commentText: string;
}) {
  const date = String(Date.now());
  const actor = buildActor(params.actorId);

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

/**
 * Posts a signed delivery to the API's ClickUp webhook route. It returns the delivery ID the API
 * records, for finding the run a matching trigger starts.
 */
export async function postClickUpDelivery({
  envelope,
  webhookSecret,
  connectionId,
}: {
  envelope: {event: string; webhook_id: string; history_items: Array<{id: string}>};
  webhookSecret: string;
  connectionId: string;
}): Promise<string> {
  const rawBody = JSON.stringify(envelope);
  const response = await fetch(
    new URL(`/webhooks/integrations/clickup/${connectionId}`, config.API_URL),
    {
      method: 'POST',
      body: rawBody,
      headers: {
        ...signClickUpHeaders(rawBody, webhookSecret),
        'content-type': 'application/json',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Signed ClickUp event delivery failed with ${response.status}.`);
  }
  const [historyItem] = envelope.history_items;
  return `${envelope.webhook_id}:${envelope.event}:${historyItem?.id}`;
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
  return await postClickUpDelivery({
    envelope: buildTaskCommentPostedEnvelope(params),
    webhookSecret: params.webhookSecret,
    connectionId: params.connectionId,
  });
}
