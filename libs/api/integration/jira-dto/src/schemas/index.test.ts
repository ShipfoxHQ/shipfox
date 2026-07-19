import {
  completeJiraSiteSelectionBodySchema,
  createJiraInstallBodySchema,
  JIRA_PROVIDER,
  jiraAccessibleResourcesSchema,
  jiraAgentToolIdSchema,
  jiraAgentToolIds,
  jiraAgentToolRequiredScopeSchema,
  jiraCommentEventPayloadSchema,
  jiraCommentWebhookEnvelopeSchema,
  jiraCommentWebhookEventNames,
  jiraIssueEventPayloadSchema,
  jiraIssueWebhookEnvelopeSchema,
  jiraIssueWebhookEventNames,
  jiraWebhookEnvelopeSchema,
  jiraWebhookEventNames,
} from '../index.js';

const issueWebhook = {
  timestamp: 1_786_257_600_000,
  issue_event_type_name: 'issue_created',
  issue: {
    id: '10001',
    key: 'ENG-999',
    fields: {
      summary: 'Create Jira DTO contracts',
      status: {id: '10000', name: 'To Do'},
      assignee: null,
      project: {id: '10000', key: 'ENG', name: 'Engineering'},
    },
  },
  user: {accountId: 'account-1', displayName: 'Noé Charmet'},
  changelog: {
    id: '10001',
    items: [{field: 'status', fromString: 'Backlog', toString: 'To Do'}],
  },
  matchedWebhookIds: [1],
};

const commentWebhook = {
  timestamp: 1_786_257_600_000,
  issue: issueWebhook.issue,
  user: issueWebhook.user,
  comment: {
    id: '10002',
    author: {accountId: 'account-2', displayName: 'Shipfox'},
    body: {type: 'doc', version: 1, content: []},
  },
  matchedWebhookIds: [1],
};

describe('JIRA_PROVIDER', () => {
  it('names the Jira provider id', () => {
    expect(JIRA_PROVIDER).toBe('jira');
  });
});

describe('Jira webhook vocabulary', () => {
  it('enumerates the curated issue and comment event names', () => {
    expect(jiraWebhookEventNames).toEqual([
      'jira:issue_created',
      'jira:issue_updated',
      'jira:issue_deleted',
      'comment_created',
      'comment_updated',
      'comment_deleted',
    ]);
  });

  it.each(jiraIssueWebhookEventNames)('parses the supported issue event %s', (webhookEvent) => {
    const result = jiraIssueWebhookEnvelopeSchema.parse({...issueWebhook, webhookEvent});

    expect(result.webhookEvent).toBe(webhookEvent);
  });

  it.each(jiraCommentWebhookEventNames)('parses the supported comment event %s', (webhookEvent) => {
    const result = jiraCommentWebhookEnvelopeSchema.parse({...commentWebhook, webhookEvent});

    expect(result.webhookEvent).toBe(webhookEvent);
  });

  it('rejects unsupported webhook events from the supported event schema', () => {
    const result = jiraWebhookEnvelopeSchema.safeParse({
      ...issueWebhook,
      webhookEvent: 'jira:worklog_updated',
    });

    expect(result.success).toBe(false);
  });
});

describe('Jira event payload schemas', () => {
  it('parses issue payloads with the injected cloud id and retains raw provider fields', () => {
    const result = jiraIssueEventPayloadSchema.parse({
      ...issueWebhook,
      webhookEvent: 'jira:issue_updated',
      cloudId: 'cloud-1',
      custom_provider_field: 'preserved',
    });

    expect(result.cloudId).toBe('cloud-1');
    expect(result.custom_provider_field).toBe('preserved');
  });

  it('parses comment payloads with the injected cloud id', () => {
    const result = jiraCommentEventPayloadSchema.parse({
      ...commentWebhook,
      webhookEvent: 'comment_created',
      cloudId: 'cloud-1',
    });

    expect(result.comment.author.accountId).toBe('account-2');
  });
});

describe('Jira OAuth and site selection schemas', () => {
  it('requires a UUID workspace id for install requests', () => {
    const result = createJiraInstallBodySchema.safeParse({workspace_id: 'workspace-1'});

    expect(result.success).toBe(false);
  });

  it('parses accessible sites and a selected cloud id', () => {
    const sites = jiraAccessibleResourcesSchema.parse([
      {
        cloud_id: 'cloud-1',
        name: 'Shipfox',
        url: 'https://shipfox.atlassian.net',
        scopes: ['read:jira-work'],
      },
    ]);
    const selection = completeJiraSiteSelectionBodySchema.parse({
      cloud_id: sites[0]?.cloud_id,
      state: 'signed-state',
    });

    expect(selection.cloud_id).toBe('cloud-1');
  });
});

describe('Jira agent tool vocabulary', () => {
  it('enumerates catalog ids with read/write required scopes', () => {
    expect(jiraAgentToolIds).toEqual([
      'get_issue',
      'search_issues',
      'get_issue_comments',
      'get_issue_transitions',
      'get_project',
      'get_user',
      'create_issue',
      'update_issue',
      'add_comment',
      'transition_issue',
      'assign_issue',
    ]);

    const toolId = jiraAgentToolIdSchema.parse('add_comment');
    const readScope = jiraAgentToolRequiredScopeSchema.parse('read');
    const writeScope = jiraAgentToolRequiredScopeSchema.parse('write');

    expect(toolId).toBe('add_comment');
    expect(readScope).toBe('read');
    expect(writeScope).toBe('write');
  });
});
