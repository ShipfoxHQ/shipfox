import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {ClickUpAgentToolsClient} from '#api/client.js';
import {
  type ClickUpAgentToolId,
  clickupAgentToolCatalog,
  clickupAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
import {ClickUpAgentToolsProvider} from '#core/agent-tools-provider.js';
import {ClickUpIntegrationProviderError} from '#core/errors.js';

function clickupConnection(
  overrides: Partial<IntegrationConnection<'clickup'>> = {},
): IntegrationConnection<'clickup'> {
  const now = new Date();
  return {
    id: 'clickup-connection-1',
    workspaceId: 'workspace-1',
    provider: 'clickup',
    externalAccountId: 'team-1',
    slug: 'clickup-acme',
    displayName: 'ClickUp Acme',
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

function catalogTool(id: ClickUpAgentToolId) {
  const tool = clickupAgentToolCatalog.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`Unknown test tool: ${id}`);
  return tool;
}

function providerOptions(
  request: ClickUpAgentToolsClient['request'] = async () => ({status: 200, body: {ok: true}}),
) {
  return {
    clickup: {request: vi.fn(request)},
    tokenStore: {getAccessToken: vi.fn().mockResolvedValue('access-token')},
  };
}

async function openSession(
  options: ReturnType<typeof providerOptions>,
  toolIds: ClickUpAgentToolId[],
  connection = clickupConnection(),
) {
  const provider = new ClickUpAgentToolsProvider(options);
  return await provider.openSession({
    connection,
    tools: toolIds.map(catalogTool),
    scope: {provider: 'clickup'},
  });
}

describe('ClickUpAgentToolsProvider', () => {
  it('publishes the six DTO tools and their selection catalog', () => {
    const provider = new ClickUpAgentToolsProvider(providerOptions());

    expect(provider.catalog()).toBe(clickupAgentToolCatalog);
    expect(provider.selectionCatalog()).toBe(clickupAgentToolSelectionCatalog);
    expect(provider.catalog().map((tool) => [tool.id, tool.sensitivity, tool.sensitive])).toEqual([
      ['get_task', 'read', false],
      ['search_tasks', 'read', false],
      ['get_task_comments', 'read', false],
      ['create_task', 'write', false],
      ['update_task', 'write', false],
      ['add_comment', 'write', false],
    ]);
    expect(clickupAgentToolSelectionCatalog.selectors.map((selector) => selector.token)).toEqual([
      'get_task',
      'search_tasks',
      'get_task_comments',
      'create_task',
      'update_task',
      'add_comment',
    ]);
  });

  it('reads the stored token without making a workspace request', async () => {
    const options = providerOptions();
    const provider = new ClickUpAgentToolsProvider(options);

    await provider.openSession({
      connection: clickupConnection({id: 'clickup-connection-7'}),
      tools: [],
      scope: {provider: 'clickup'},
    });

    expect(options.tokenStore.getAccessToken).toHaveBeenCalledWith({
      connectionId: 'clickup-connection-7',
    });
    expect(options.clickup.request).not.toHaveBeenCalled();
  });

  it('builds the get-task request with the configured team for custom IDs', async () => {
    const body = {id: 'custom-123', name: 'ClickUp task'};
    const options = providerOptions(async () => ({status: 200, body}));
    const session = await openSession(options, ['get_task']);

    const result = await session.call({
      toolId: 'get_task',
      arguments: {task_id: 'custom-123', custom_task_id: true, include_subtasks: true},
    });

    expect(options.clickup.request).toHaveBeenCalledWith({
      accessToken: 'access-token',
      teamId: 'team-1',
      method: 'GET',
      path: '/task/custom-123',
      query: {
        include_markdown_description: true,
        include_subtasks: true,
        custom_task_ids: true,
        team_id: 'team-1',
      },
      operation: 'get_task',
    });
    expect(result).toEqual({
      content: [{type: 'text', text: JSON.stringify(body)}],
      structuredContent: body,
    });
  });

  it('builds the filtered team task request without accepting a caller team id', async () => {
    const options = providerOptions();
    const session = await openSession(
      options,
      ['search_tasks'],
      clickupConnection({externalAccountId: 'configured-team'}),
    );

    await session.call({
      toolId: 'search_tasks',
      arguments: {
        list_ids: ['list-1'],
        statuses: ['open'],
        assignees: ['user-1'],
        tags: ['shipfox'],
        include_closed: false,
        subtasks: true,
        date_updated_gt: 1700000000000,
        due_date_lt: 1800000000000,
        order_by: 'updated',
        page: 2,
        team_id: 'caller-team',
      },
    });

    expect(options.clickup.request).toHaveBeenCalledWith({
      accessToken: 'access-token',
      teamId: 'configured-team',
      method: 'GET',
      path: '/team/configured-team/task',
      query: {
        'list_ids[]': ['list-1'],
        'statuses[]': ['open'],
        'assignees[]': ['user-1'],
        'tags[]': ['shipfox'],
        include_closed: false,
        subtasks: true,
        date_updated_gt: 1700000000000,
        due_date_lt: 1800000000000,
        order_by: 'updated',
        page: 2,
      },
      operation: 'search_tasks',
    });
  });

  it('builds comment-list, create, update, and add-comment requests', async () => {
    const options = providerOptions();
    const commentSession = await openSession(options, ['get_task_comments']);
    const createSession = await openSession(options, ['create_task']);
    const updateSession = await openSession(options, ['update_task']);
    const addCommentSession = await openSession(options, ['add_comment']);

    await commentSession.call({
      toolId: 'get_task_comments',
      arguments: {
        task_id: 'TASK-1',
        custom_task_id: true,
        start: 1700000000000,
        start_id: 'comment-1',
      },
    });
    await createSession.call({
      toolId: 'create_task',
      arguments: {
        list_id: 'list-1',
        name: 'New task',
        markdown_content: '**Details**',
        assignees: ['user-1'],
        tags: ['agent'],
        status: 'open',
        priority: 2,
        due_date: 1800000000000,
        parent: 'parent-1',
        custom_fields: [{id: 'field-1', value: 'value'}],
      },
    });
    await updateSession.call({
      toolId: 'update_task',
      arguments: {
        task_id: 'TASK-1',
        custom_task_id: true,
        name: 'Updated task',
        markdown_content: 'Updated',
        status: 'closed',
        priority: 4,
        due_date: 1800000000000,
        assignees: {add: ['user-2'], rem: ['user-1']},
      },
    });
    await addCommentSession.call({
      toolId: 'add_comment',
      arguments: {task_id: 'TASK-1', custom_task_id: true, body: 'Plain text'},
    });

    expect(options.clickup.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: '/task/TASK-1/comment',
        query: {
          custom_task_ids: true,
          team_id: 'team-1',
          start: 1700000000000,
          start_id: 'comment-1',
        },
      }),
    );
    expect(options.clickup.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'POST',
        path: '/list/list-1/task',
        body: {
          name: 'New task',
          markdown_content: '**Details**',
          assignees: ['user-1'],
          tags: ['agent'],
          status: 'open',
          priority: 2,
          due_date: 1800000000000,
          parent: 'parent-1',
          custom_fields: [{id: 'field-1', value: 'value'}],
          notify_all: false,
        },
      }),
    );
    expect(options.clickup.request).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: 'PUT',
        path: '/task/TASK-1',
        query: {custom_task_ids: true, team_id: 'team-1'},
        body: {
          name: 'Updated task',
          markdown_content: 'Updated',
          status: 'closed',
          priority: 4,
          due_date: 1800000000000,
          assignees: {add: ['user-2'], rem: ['user-1']},
        },
      }),
    );
    expect(options.clickup.request).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        method: 'POST',
        path: '/task/TASK-1/comment',
        query: {custom_task_ids: true, team_id: 'team-1'},
        body: {comment_text: 'Plain text', notify_all: false},
      }),
    );
  });

  it('maps provider, validation, access, rate-limit, server, and timeout errors', async () => {
    const cases = [
      ['access-denied', 'Access denied', undefined],
      ['rate-limited', 'Slow down', 12],
      ['provider-unavailable', 'Unavailable', undefined],
      ['timeout', 'Timed out', undefined],
    ] as const;

    for (const [reason, message, retryAfterSeconds] of cases) {
      const options = providerOptions(() =>
        Promise.reject(new ClickUpIntegrationProviderError(reason, message, retryAfterSeconds)),
      );
      const session = await openSession(options, ['get_task']);
      const result = await session.call({toolId: 'get_task', arguments: {task_id: 'task-1'}});

      expect(result).toMatchObject({
        isError: true,
        content: [{type: 'text', text: message}],
        structuredContent: {
          code: reason,
          ...(retryAfterSeconds === undefined ? {} : {retryAfterSeconds}),
        },
      });
    }

    const options = providerOptions(async () => ({
      status: 400,
      body: {err: 'Invalid task', ECODE: 'TASK_001'},
    }));
    const session = await openSession(options, ['get_task']);
    await expect(
      session.call({toolId: 'get_task', arguments: {task_id: 'bad'}}),
    ).resolves.toMatchObject({
      isError: true,
      content: [{type: 'text', text: 'Invalid task (TASK_001)'}],
      structuredContent: {code: 'provider-rejected'},
    });

    const notFoundOptions = providerOptions(async () => ({status: 404, body: undefined}));
    const notFoundSession = await openSession(notFoundOptions, ['get_task']);
    await expect(
      notFoundSession.call({toolId: 'get_task', arguments: {task_id: 'missing'}}),
    ).resolves.toMatchObject({
      isError: true,
      content: [{type: 'text', text: 'ClickUp resource was not found'}],
      structuredContent: {code: 'provider-rejected'},
    });
  });

  it('rejects unselected tools and missing required arguments', async () => {
    const options = providerOptions();
    const session = await openSession(options, ['get_task']);

    await expect(
      session.call({toolId: 'add_comment', arguments: {task_id: 'task-1', body: 'Comment'}}),
    ).resolves.toEqual({
      isError: true,
      content: [{type: 'text', text: 'Unknown ClickUp tool: add_comment'}],
      structuredContent: {code: 'invalid-request'},
    });
    await expect(session.call({toolId: 'get_task', arguments: {}})).resolves.toEqual({
      isError: true,
      content: [{type: 'text', text: 'Missing required parameter: task_id'}],
      structuredContent: {code: 'invalid-request'},
    });
    expect(options.clickup.request).not.toHaveBeenCalled();
  });
});
