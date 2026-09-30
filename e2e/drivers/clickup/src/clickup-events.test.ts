import {buildTaskStatusUpdatedEnvelope, buildTaskTagUpdatedEnvelope} from './clickup-events.js';

const params = {
  webhookId: 'webhook-1',
  taskId: '86abc',
  historyItemId: 'history-1',
  actorId: 'user-1',
  listId: 'list-1',
};

describe('buildTaskTagUpdatedEnvelope', () => {
  it('lists the tags before and after the change on the List that holds the task', () => {
    const envelope = buildTaskTagUpdatedEnvelope({
      ...params,
      tags: ['bug', 'shipfox'],
      previousTags: ['bug'],
    });

    expect(envelope).toMatchObject({
      event: 'taskTagUpdated',
      webhook_id: 'webhook-1',
      task_id: '86abc',
      history_items: [
        {
          id: 'history-1',
          field: 'tag',
          parent_id: 'list-1',
          before: [{name: 'bug'}],
          after: [{name: 'bug'}, {name: 'shipfox'}],
        },
      ],
    });
  });
});

describe('buildTaskStatusUpdatedEnvelope', () => {
  it('carries the status the task moved from and to', () => {
    const envelope = buildTaskStatusUpdatedEnvelope({
      ...params,
      status: 'ready for dev',
      previousStatus: 'to do',
    });

    expect(envelope).toMatchObject({
      event: 'taskStatusUpdated',
      history_items: [
        {
          field: 'status',
          parent_id: 'list-1',
          before: {status: 'to do'},
          after: {status: 'ready for dev'},
        },
      ],
    });
  });
});
