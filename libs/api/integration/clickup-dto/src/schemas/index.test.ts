import {
  CLICKUP_PROVIDER,
  clickupAgentToolIdSchema,
  clickupAgentToolIds,
  clickupAgentToolRequiredScopeSchema,
  clickupCallbackQuerySchema,
  clickupCommentWebhookEnvelopeSchema,
  clickupEventPayloadSchema,
  clickupTaskDeletedWebhookEnvelopeSchema,
  clickupTaskWebhookEnvelopeSchema,
  clickupWebhookEnvelopeSchema,
  clickupWebhookEventNames,
} from '../index.js';

const webhookUser = {
  id: '61234567',
  username: 'ClickUp User',
  email: 'user@example.com',
  initials: 'CU',
};

const historyItem = {
  id: 'history-1',
  type: 1,
  date: '1786257600000',
  field: 'status',
  parent_id: '901200123456',
  data: {status_type: 'open'},
  source: {trigger: 'webhook'},
  user: webhookUser,
  before: {status: null},
  after: {status: {status: 'Open', type: 'open'}},
};

const taskCreatedSample = {
  event: 'taskCreated',
  webhook_id: 'webhook-1',
  task_id: '86ab1cd2e',
  history_items: [
    historyItem,
    {
      ...historyItem,
      id: 'history-2',
      field: 'task_creation',
      data: {},
      before: null,
      after: {name: 'New task'},
    },
  ],
  provider_field: 'preserved',
};

const taskStatusUpdatedSample = {
  ...taskCreatedSample,
  event: 'taskStatusUpdated',
  history_items: [historyItem],
};

const taskCommentPostedSample = {
  event: 'taskCommentPosted',
  webhook_id: 'webhook-1',
  task_id: '86ab1cd2e',
  history_items: [
    {
      ...historyItem,
      id: 'history-comment-1',
      field: 'comment',
      comment: {
        id: 'comment-1',
        text_content: 'Please review this task.',
        comment: [{text: 'Please review this task.'}],
        user: webhookUser,
        assignee: null,
        assigned_by: null,
        date: '1786257600000',
      },
    },
  ],
};

const taskDeletedSample = {
  event: 'taskDeleted',
  webhook_id: 'webhook-1',
  task_id: '86ab1cd2e',
};

describe('ClickUp webhook vocabulary', () => {
  it('exports the eleven provider event names in ClickUp order', () => {
    expect(clickupWebhookEventNames).toEqual([
      'taskCreated',
      'taskUpdated',
      'taskDeleted',
      'taskMoved',
      'taskStatusUpdated',
      'taskAssigneeUpdated',
      'taskPriorityUpdated',
      'taskDueDateUpdated',
      'taskTagUpdated',
      'taskCommentPosted',
      'taskCommentUpdated',
    ]);
  });

  it('names the ClickUp provider id', () => {
    expect(CLICKUP_PROVIDER).toBe('clickup');
  });
});

describe('ClickUp webhook envelopes', () => {
  it('parses the recorded taskCreated sample with an unbounded history array', () => {
    const result = clickupTaskWebhookEnvelopeSchema.parse(taskCreatedSample);

    expect(result.history_items).toHaveLength(2);
    expect(result.provider_field).toBe('preserved');
  });

  it('parses the recorded taskStatusUpdated sample', () => {
    const result = clickupWebhookEnvelopeSchema.parse(taskStatusUpdatedSample);

    expect(result.event).toBe('taskStatusUpdated');
  });

  it('parses the recorded taskCommentPosted sample and preserves nested fields', () => {
    const result = clickupCommentWebhookEnvelopeSchema.parse(taskCommentPostedSample);

    expect(result.history_items[0]?.comment.text_content).toBe('Please review this task.');
    expect(result.history_items[0]?.comment.user.id).toBe('61234567');
  });

  it('parses the recorded taskDeleted sample without history items', () => {
    const result = clickupTaskDeletedWebhookEnvelopeSchema.parse(taskDeletedSample);

    expect(result.event).toBe('taskDeleted');
    expect('history_items' in result).toBe(false);
  });

  it('parses a history item without data, source, or before, as ClickUp sends a tag change', () => {
    const {data: _data, source: _source, before: _before, ...tagItem} = historyItem;
    const sample = {
      ...taskCreatedSample,
      event: 'taskTagUpdated',
      history_items: [{...tagItem, field: 'tag', after: [{name: 'shipfox'}]}],
    };

    expect(clickupWebhookEnvelopeSchema.safeParse(sample).success).toBe(true);
  });

  it('parses a history item without after, and a user whose profile fields are null', () => {
    const {after: _after, ...item} = historyItem;
    const sample = {
      ...taskStatusUpdatedSample,
      history_items: [{...item, user: {id: 61234567, username: null, email: null, initials: null}}],
    };

    expect(clickupWebhookEnvelopeSchema.safeParse(sample).success).toBe(true);
  });

  it('rejects actor-bearing events without history items', () => {
    const taskResult = clickupTaskWebhookEnvelopeSchema.safeParse({
      ...taskStatusUpdatedSample,
      history_items: [],
    });
    const commentResult = clickupCommentWebhookEnvelopeSchema.safeParse({
      ...taskCommentPostedSample,
      history_items: [],
    });

    expect(taskResult.success).toBe(false);
    expect(commentResult.success).toBe(false);
  });

  it('adds the Shipfox team id to the published payload type', () => {
    const result = clickupEventPayloadSchema.parse({...taskStatusUpdatedSample, team_id: 'team-1'});

    expect(result.team_id).toBe('team-1');
  });
});

describe('ClickUp install and tool DTOs', () => {
  it('accepts either an OAuth code or an OAuth error', () => {
    const codeResult = clickupCallbackQuerySchema.parse({
      code: 'grant-code',
      state: 'signed-state',
    });
    const errorResult = clickupCallbackQuerySchema.parse({
      error: 'access_denied',
      error_description: 'The user denied access.',
      state: 'signed-state',
    });

    expect('code' in codeResult && codeResult.code).toBe('grant-code');
    expect('error' in errorResult && errorResult.error).toBe('access_denied');
  });

  it('exposes exactly the nine ClickUp agent tools and both scopes', () => {
    expect(clickupAgentToolIds).toHaveLength(9);
    expect(clickupAgentToolIds).toEqual([
      'get_task',
      'search_tasks',
      'get_task_comments',
      'create_task',
      'update_task',
      'add_comment',
      'add_tag',
      'remove_tag',
      'set_custom_field',
    ]);
    expect(clickupAgentToolIdSchema.parse('get_task')).toBe('get_task');
    expect(clickupAgentToolRequiredScopeSchema.parse('read')).toBe('read');
    expect(clickupAgentToolRequiredScopeSchema.parse('write')).toBe('write');
  });
});
