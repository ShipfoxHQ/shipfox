import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';
import {clickupWebhookEventNames} from './schemas/index.js';

const eventDetails = {
  taskCreated: {
    summary: 'A ClickUp task is created.',
    emittedWhen: 'ClickUp sends a taskCreated webhook.',
  },
  taskUpdated: {
    summary: 'A ClickUp task changes.',
    emittedWhen: 'ClickUp sends a taskUpdated webhook.',
  },
  taskDeleted: {
    summary: 'A ClickUp task is deleted.',
    emittedWhen: 'ClickUp sends a taskDeleted webhook.',
  },
  taskMoved: {
    summary: 'A ClickUp task is moved.',
    emittedWhen: 'ClickUp sends a taskMoved webhook.',
  },
  taskStatusUpdated: {
    summary: 'A ClickUp task status changes.',
    emittedWhen: 'ClickUp sends a taskStatusUpdated webhook.',
  },
  taskAssigneeUpdated: {
    summary: 'A ClickUp task assignee changes.',
    emittedWhen: 'ClickUp sends a taskAssigneeUpdated webhook.',
  },
  taskPriorityUpdated: {
    summary: 'A ClickUp task priority changes.',
    emittedWhen: 'ClickUp sends a taskPriorityUpdated webhook.',
  },
  taskDueDateUpdated: {
    summary: 'A ClickUp task due date changes.',
    emittedWhen: 'ClickUp sends a taskDueDateUpdated webhook.',
  },
  taskTagUpdated: {
    summary: 'A ClickUp task tag changes.',
    emittedWhen: 'ClickUp sends a taskTagUpdated webhook.',
  },
  taskCommentPosted: {
    summary: 'A comment is posted on a ClickUp task.',
    emittedWhen: 'ClickUp sends a taskCommentPosted webhook.',
  },
  taskCommentUpdated: {
    summary: 'A comment on a ClickUp task changes.',
    emittedWhen: 'ClickUp sends a taskCommentUpdated webhook.',
  },
} as const satisfies Record<
  (typeof clickupWebhookEventNames)[number],
  {
    summary: string;
    emittedWhen: string;
  }
>;

export const clickupEventCatalog = {
  provider: 'ClickUp',
  events: clickupWebhookEventNames.map((name) => ({
    name,
    ...eventDetails[name],
    payloadKind: 'shipfox-normalized' as const,
  })),
} as const satisfies IntegrationEventCatalog;
