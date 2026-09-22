import {
  eventPayloadJsonSchema,
  type IntegrationEventCatalog,
} from '@shipfox/api-integration-core-dto';
import {
  clickupCommentEventPayloadSchema,
  clickupCommentWebhookEventNames,
  clickupTaskDeletedEventPayloadSchema,
  clickupTaskEventPayloadSchema,
  clickupWebhookEventNames,
} from './schemas/index.js';

const clickupWebhookDocsUrl = 'https://developer.clickup.com/docs/webhooks';
const clickupTaskPayloadDocsUrl = 'https://developer.clickup.com/docs/webhooktaskpayloads';

const eventSummaries = {
  taskCreated: 'A ClickUp task is created.',
  taskUpdated: 'A ClickUp task changes.',
  taskDeleted: 'A ClickUp task is deleted.',
  taskMoved: 'A ClickUp task is moved.',
  taskStatusUpdated: 'A ClickUp task status changes.',
  taskAssigneeUpdated: 'A ClickUp task assignee changes.',
  taskPriorityUpdated: 'A ClickUp task priority changes.',
  taskDueDateUpdated: 'A ClickUp task due date changes.',
  taskTagUpdated: 'A ClickUp task tag changes.',
  taskCommentPosted: 'A comment is posted on a ClickUp task.',
  taskCommentUpdated: 'A comment on a ClickUp task changes.',
} as const satisfies Record<(typeof clickupWebhookEventNames)[number], string>;

const commentEvents = new Set<string>(clickupCommentWebhookEventNames);

function familyOf(name: (typeof clickupWebhookEventNames)[number]): string {
  if (name === 'taskDeleted') return 'task_deleted';
  return commentEvents.has(name) ? 'comment' : 'task';
}

export const clickupEventCatalog = {
  provider: 'ClickUp',
  families: [
    {
      key: 'task',
      title: 'Tasks',
      summary:
        'Changes to a ClickUp task. The event identifies the task and describes the change. It does not include the complete task.',
      payloadKind: 'shipfox-normalized',
      payloadSchema: eventPayloadJsonSchema(clickupTaskEventPayloadSchema),
      payloadDocUrl: clickupTaskPayloadDocsUrl,
      shipfoxFields: ['team_id'],
      notes: [
        'ClickUp can send several events for one action. Creating a task sends `taskCreated` and `taskStatusUpdated`. Status, assignee, priority, due date, and tag changes also send `taskUpdated`. Choose a specific event name to respond to only one kind of change.',
      ],
    },
    {
      key: 'task_deleted',
      title: 'Task deletion',
      summary: 'A ClickUp task is deleted. The event names the task and has no change records.',
      payloadKind: 'shipfox-normalized',
      payloadSchema: eventPayloadJsonSchema(clickupTaskDeletedEventPayloadSchema),
      payloadDocUrl: clickupWebhookDocsUrl,
      shipfoxFields: ['team_id'],
    },
    {
      key: 'comment',
      title: 'Comments',
      summary: 'Comments on a ClickUp task. Each change record includes the comment.',
      payloadKind: 'shipfox-normalized',
      payloadSchema: eventPayloadJsonSchema(clickupCommentEventPayloadSchema),
      payloadDocUrl: clickupWebhookDocsUrl,
      shipfoxFields: ['team_id'],
    },
  ],
  events: clickupWebhookEventNames.map((name) => ({
    name,
    family: familyOf(name),
    summary: eventSummaries[name],
  })),
} as const satisfies IntegrationEventCatalog;
