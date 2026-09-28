import {workflowModel} from '#test/index.js';
import type {AgentToolCatalogEntry, AgentToolMaterializationContext} from './agent-tools.js';
import {
  createAgentToolMaterializationSnapshot,
  loadAgentToolMaterializationContext,
  materializeActionIntegrations,
  materializeToolStep,
} from './agent-tools.js';
import {AgentIntegrationMaterializationError} from './errors.js';

function materializationContext(): AgentToolMaterializationContext {
  const tool: AgentToolCatalogEntry = {
    id: 'issue_read',
    description: 'Read issues.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'read'}],
    result: 'json',
    inputSchema: {type: 'object'},
    methods: [
      {
        id: 'get',
        description: 'Get an issue.',
        sensitivity: 'read',
        sensitive: false,
        requiredScope: [{permission: 'issues', access: 'read'}],
      },
    ],
  };
  const checkRunTool: AgentToolCatalogEntry = {
    id: 'check_run_write',
    description: 'Create or update check runs.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'checks', access: 'write'}],
    result: 'json',
    inputSchema: {type: 'object', properties: {method: {type: 'string'}}},
    outputSchema: {
      type: 'object',
      properties: {check_run: {type: 'object'}},
      required: ['check_run'],
    },
    methods: [
      {
        id: 'create',
        description: 'Create a check run.',
        sensitivity: 'write',
        sensitive: false,
        requiredScope: [{permission: 'checks', access: 'write'}],
      },
      {
        id: 'update',
        description: 'Update a check run.',
        sensitivity: 'write',
        sensitive: false,
        requiredScope: [{permission: 'checks', access: 'write'}],
      },
    ],
  };

  return {
    catalogs: new Map([['github', [tool, checkRunTool]]]),
    workspaceConnectionSnapshot: new Map([
      ['github-main', {id: 'connection-1', provider: 'github', capabilities: ['agent_tools']}],
    ]),
    defaultConnection: {id: 'connection-1', slug: 'github-main', provider: 'github'},
  };
}

describe('loadAgentToolMaterializationContext', () => {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();

  test('returns undefined for a model with only run steps', async () => {
    const model = workflowModel({
      name: 'Plain',
      runner: 'ubuntu-latest',
    });

    await expect(
      loadAgentToolMaterializationContext({model, workspaceId, projectId}),
    ).resolves.toBeUndefined();
  });

  test('returns undefined for a model with only checkout steps', async () => {
    const model = workflowModel({
      name: 'Checkout',
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [
            {
              checkout: {
                repository: 'acme/platform',
                fetchDepth: 1,
                permissions: {contents: 'read'},
                persistCredentials: true,
              },
            },
          ],
        },
      },
    });

    await expect(
      loadAgentToolMaterializationContext({model, workspaceId, projectId}),
    ).resolves.toBeUndefined();
  });

  test('returns undefined for agent steps without integrations', async () => {
    const model = workflowModel({
      name: 'Agent',
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [{prompt: 'Do the thing'}],
        },
      },
    });

    await expect(
      loadAgentToolMaterializationContext({model, workspaceId, projectId}),
    ).resolves.toBeUndefined();
  });

  test('does not short-circuit for a tool-step-only model', async () => {
    const model = workflowModel({
      name: 'Tools',
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [
            {
              tool: 'get_issue',
              connection: 'linear-main',
              with: {id: 'ENG-1'},
            },
          ],
        },
      },
    });

    // A tool step is an integration tool reference, so the loader must not
    // return early: with project access missing it reports the materialization
    // setup failure instead of silently skipping tool-step runs.
    await expect(
      loadAgentToolMaterializationContext({model, workspaceId, projectId}),
    ).rejects.toThrow(AgentIntegrationMaterializationError);
  });

  test('materializes a selected tool method from the catalog', () => {
    const materialized = materializeToolStep({
      jobKey: 'build',
      stepId: 'call',
      tool: {id: 'issue_read', method: 'get'},
      connection: 'github-main',
      context: materializationContext(),
      snapshot: undefined,
    });

    expect(materialized).toEqual({
      connectionId: 'connection-1',
      connectionSlug: 'github-main',
      provider: 'github',
      id: 'issue_read',
      method: 'get',
      sensitivity: 'read',
      sensitive: false,
      requiredScope: [{permission: 'issues', access: 'read'}],
      inputSchema: {type: 'object'},
    });
    expect(Object.isFrozen(materialized)).toBe(true);
  });

  test('materializes a check-run method with its write scope and output schema', () => {
    const materialized = materializeToolStep({
      jobKey: 'build',
      stepId: 'finish-check',
      tool: {id: 'check_run_write', method: 'update'},
      connection: 'github-main',
      context: materializationContext(),
      snapshot: undefined,
    });

    expect(materialized).toEqual({
      connectionId: 'connection-1',
      connectionSlug: 'github-main',
      provider: 'github',
      id: 'check_run_write',
      method: 'update',
      sensitivity: 'write',
      sensitive: false,
      requiredScope: [{permission: 'checks', access: 'write'}],
      inputSchema: {type: 'object', properties: {method: {type: 'string'}}},
      outputSchema: {
        type: 'object',
        properties: {check_run: {type: 'object'}},
        required: ['check_run'],
      },
    });
  });

  test('includes tool steps in the run-attempt materialization snapshot', () => {
    const model = workflowModel({
      name: 'Tools',
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [
            {
              tool: 'issue_read.get',
              connection: 'github-main',
              with: {owner: 'acme'},
            },
          ],
        },
      },
    });

    expect(
      createAgentToolMaterializationSnapshot({model, context: materializationContext()}),
    ).toMatchObject({
      steps: [
        {
          jobKey: 'build',
          stepId: 'build-step-1',
          tool: {id: 'issue_read', method: 'get', connectionSlug: 'github-main'},
        },
      ],
    });
  });
});

describe('action integrations', () => {
  function slackCatalog(): AgentToolCatalogEntry[] {
    return [
      {
        id: 'thread',
        description: 'Read and reply to threads.',
        sensitivity: 'read',
        sensitive: false,
        requiredScope: ['channels:history'],
        result: 'json',
        inputSchema: {type: 'object'},
        methods: [
          {
            id: 'read',
            description: 'Read a thread.',
            sensitivity: 'read',
            sensitive: false,
            requiredScope: ['channels:history'],
          },
        ],
      },
      {
        id: 'download_file',
        description: 'Download a file.',
        sensitivity: 'read',
        sensitive: false,
        requiredScope: ['files:read'],
        result: 'file',
        inputSchema: {type: 'object', properties: {url: {type: 'string'}}},
      },
    ];
  }

  function slackContext(catalog = slackCatalog()): AgentToolMaterializationContext {
    return {
      catalogs: new Map([['slack', catalog]]),
      workspaceConnectionSnapshot: new Map([
        ['team-slack', {id: 'connection-slack', provider: 'slack', capabilities: ['agent_tools']}],
        ['github-main', {id: 'connection-1', provider: 'github', capabilities: ['agent_tools']}],
      ]),
      defaultConnection: {id: 'connection-1', slug: 'github-main', provider: 'github'},
    };
  }

  function actionModel(connection = 'team-slack') {
    return workflowModel({
      name: 'Actions',
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [
            {
              key: 'thread',
              uses: './.shipfox/actions/slack-thread',
              action: {
                integrations: {
                  slack: {
                    provider: 'slack',
                    connection,
                    include: ['thread', 'download_file'],
                    allowWrite: false,
                  },
                },
              },
            },
          ],
        },
      },
    });
  }

  test('freezes each alias to its connection and concrete tools with their result kind', () => {
    const snapshot = createAgentToolMaterializationSnapshot({
      model: actionModel(),
      context: slackContext(),
    });

    expect(snapshot).toEqual({
      steps: [
        {
          jobKey: 'build',
          stepId: 'build-thread',
          actionIntegrations: {
            slack: {
              connectionId: 'connection-slack',
              connectionSlug: 'team-slack',
              provider: 'slack',
              requiredScope: ['channels:history', 'files:read'],
              tools: [
                {
                  id: 'thread',
                  sensitivity: 'read',
                  sensitive: false,
                  requiredScope: ['channels:history'],
                  inputSchema: {type: 'object'},
                  result: 'json',
                  methods: [
                    {
                      id: 'read',
                      token: 'thread.read',
                      description: 'Read a thread.',
                      sensitivity: 'read',
                      sensitive: false,
                      requiredScope: ['channels:history'],
                    },
                  ],
                },
                {
                  id: 'download_file',
                  sensitivity: 'read',
                  sensitive: false,
                  requiredScope: ['files:read'],
                  inputSchema: {type: 'object', properties: {url: {type: 'string'}}},
                  result: 'file',
                },
              ],
            },
          },
        },
      ],
    });
  });

  test('does not short-circuit for a model whose only integrations are action aliases', async () => {
    await expect(
      loadAgentToolMaterializationContext({
        model: actionModel(),
        workspaceId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(AgentIntegrationMaterializationError);
  });

  test('fails when the bound connection is unavailable', () => {
    expect(() =>
      createAgentToolMaterializationSnapshot({
        model: actionModel('removed-slack'),
        context: slackContext(),
      }),
    ).toThrow(
      new AgentIntegrationMaterializationError(
        'Integration connection removed-slack was not found while materializing action integration slack',
      ),
    );
  });

  test('fails when the bound connection belongs to another provider', () => {
    expect(() =>
      createAgentToolMaterializationSnapshot({
        model: actionModel('github-main'),
        context: slackContext(),
      }),
    ).toThrow(
      new AgentIntegrationMaterializationError(
        'Action integration slack expects a slack connection, but github-main is github',
      ),
    );
  });

  test('reuses the frozen grant when the catalog later gains a method', () => {
    const snapshot = createAgentToolMaterializationSnapshot({
      model: actionModel(),
      context: slackContext(),
    });
    const widened = slackCatalog().map((entry) =>
      entry.id === 'thread'
        ? {
            ...entry,
            methods: [
              ...(entry.methods ?? []),
              {
                id: 'reply',
                description: 'Reply to a thread.',
                sensitivity: 'write' as const,
                sensitive: false,
                requiredScope: ['chat:write'],
              },
            ],
          }
        : entry,
    );

    const reused = materializeActionIntegrations({
      jobKey: 'build',
      stepId: 'build-thread',
      integrations: {
        slack: {
          provider: 'slack',
          connection: 'team-slack',
          include: ['thread', 'download_file'],
          allowWrite: false,
        },
      },
      context: slackContext(widened),
      snapshot,
    });

    expect(reused).toEqual(snapshot?.steps[0]?.actionIntegrations);
    expect(reused.slack?.tools[0]?.methods?.map((method) => method.id)).toEqual(['read']);
  });
});
