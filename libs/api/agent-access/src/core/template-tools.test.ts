import {
  agentAccessEnvelopeSchema,
  getWorkflowTemplateInputJsonSchema,
  getWorkflowTemplateResultSchema,
  listWorkflowTemplatesResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {createTemplateLoader, type WorkflowTemplateAsset} from '@shipfox/workflow-templates';
import {createAgentAccessTemplateTools} from './template-tools.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const sourceConnectionId = '00000000-0000-4000-8000-000000000003';
const context: AgentAccessContext = {
  userId: '00000000-0000-4000-8000-000000000004',
  workspaceId,
  credential: {
    kind: 'oauth_grant',
    grantId: '00000000-0000-4000-8000-000000000005',
    clientId: 'test',
  },
};

const asset: WorkflowTemplateAsset = {
  manifest: {
    id: 'fixture-template',
    revision: 1,
    added_at: '2026-10-01',
    title: 'Fixture template',
    summary: 'A fixture template.',
    roles: {
      tracker: {providers: ['linear', 'github']},
      source: {from: 'project', providers: ['github']},
    },
    options: [{id: 'mode', choices: [{id: 'safe', default: true}]}],
    slots: [],
    secrets: [],
    variables: [],
  },
  workflow: 'name: fixture\ntriggers:\n  # part:tracker.trigger\njobs: {}',
  guide: '# Follow this fixture',
  parts: {
    tracker: {
      linear: {trigger: 'source: linear\n  event: issue.created'},
      github: {trigger: 'source: github\n  event: issues.opened'},
    },
    source: {github: {unused: 'unused'}},
  } as unknown as WorkflowTemplateAsset['parts'],
};
const setupGuide = {
  revision: 3,
  guide_markdown: '# Set up a workflow\n\nFollow all ten steps.',
};

describe('agent-access template tools', () => {
  test('returns the revisioned first-party setup guide', async () => {
    const tools = createTools(integrationClient([]));
    const getGuide = getTool(tools, 'get_workflow_setup_guide');

    const response = await getGuide.execute({context, arguments: {}});

    expect(response).toEqual({ok: true, result: setupGuide});
    expect(getGuide.annotations).toEqual({readOnlyHint: true});
    expect(getGuide.description).toContain('first-party guidance meant to be followed');
  });

  test('lists compatibility and active connection suggestions per provider', async () => {
    const integrations = integrationClient([
      connection('linear-main', 'linear'),
      connection('github-main', 'github'),
      connection('github-secondary', 'github'),
      {...connection('disabled', 'github'), lifecycleStatus: 'disabled' as const},
    ]);
    const tools = createTools(integrations);
    const list = getTool(tools, 'list_workflow_templates');

    const response = await list.execute({context, arguments: {}});

    expect(response).toEqual({
      ok: true,
      result: {
        templates: [
          expect.objectContaining({
            id: 'fixture-template',
            compatible: true,
            missing_providers: [],
            roles: [
              {
                role: 'tracker',
                providers: [
                  {provider: 'linear', compatible: true, suggested_bindings: ['linear-main']},
                  {
                    provider: 'github',
                    compatible: true,
                    suggested_bindings: ['github-main', 'github-secondary'],
                  },
                ],
              },
              {
                role: 'source',
                providers: [
                  {
                    provider: 'github',
                    compatible: true,
                    suggested_bindings: ['github-main', 'github-secondary'],
                  },
                ],
              },
            ],
          }),
        ],
      },
    });
    if (!response.ok) throw new Error('Expected a successful list response');
    expect(listWorkflowTemplatesResultSchema.safeParse(response.result).success).toBe(true);
  });

  test('resolves each profile and step role to the first available model', async () => {
    const integrations = integrationClient([connection('linear-main', 'linear')]);
    integrations.resolveConnectionById.mockResolvedValue({
      id: sourceConnectionId,
      provider: 'github',
      slug: 'github-project',
      displayName: 'Project GitHub',
      lifecycleStatus: 'active',
    });
    const projects = projectClient();
    const response = await getTool(
      createTools(
        integrations,
        projects,
        agentClient([
          {id: 'claude-haiku-4-5', provider: 'anthropic'},
          {id: 'claude-sonnet-5', provider: 'anthropic'},
          {id: 'claude-opus-5', provider: 'anthropic'},
        ]),
      ),
      'get_workflow_template',
    ).execute({
      context,
      arguments: {template_id: 'fixture-template', project_id: projectId, tracker: 'linear'},
    });

    expect(response).toMatchObject({
      ok: true,
      result: {
        resolved_models: {
          balanced: {
            mechanical: {model: 'claude-haiku-4-5'},
            implementation: {model: 'claude-sonnet-5'},
            review: {model: 'claude-sonnet-5'},
          },
          economy: {
            mechanical: {model: 'claude-haiku-4-5'},
            implementation: {model: 'claude-haiku-4-5'},
            review: {model: 'claude-haiku-4-5'},
          },
          strongest: {
            mechanical: {model: 'claude-sonnet-5'},
            implementation: {model: 'claude-opus-5'},
            review: {model: 'claude-opus-5'},
          },
        },
      },
    });
  });

  test('falls back to the workspace default model when no preference matches', async () => {
    const integrations = integrationClient([connection('linear-main', 'linear')]);
    integrations.resolveConnectionById.mockResolvedValue({
      id: sourceConnectionId,
      provider: 'github',
      slug: 'github-project',
      displayName: 'Project GitHub',
      lifecycleStatus: 'active',
    });
    const response = await getTool(
      createTools(
        integrations,
        projectClient(),
        agentClient([{id: 'workspace-default', provider: 'custom'}], {
          id: 'workspace-default',
          provider: 'custom',
        }),
      ),
      'get_workflow_template',
    ).execute({
      context,
      arguments: {template_id: 'fixture-template', project_id: projectId, tracker: 'linear'},
    });

    expect(response).toMatchObject({
      ok: true,
      result: {
        resolved_models: {
          balanced: {
            mechanical: {model: 'workspace-default'},
            implementation: {model: 'workspace-default'},
            review: {model: 'workspace-default'},
          },
        },
      },
    });
  });

  test('returns no-compatible-model when the workspace has no compatible default', async () => {
    const integrations = integrationClient([connection('linear-main', 'linear')]);
    integrations.resolveConnectionById.mockResolvedValue({
      id: sourceConnectionId,
      provider: 'github',
      slug: 'github-project',
      displayName: 'Project GitHub',
      lifecycleStatus: 'active',
    });
    const response = await getTool(
      createTools(
        integrations,
        projectClient(),
        agentClient([{id: 'unlisted', provider: 'custom'}], null),
      ),
      'get_workflow_template',
    ).execute({
      context,
      arguments: {template_id: 'fixture-template', project_id: projectId, tracker: 'linear'},
    });

    expect(response).toMatchObject({
      ok: true,
      result: {
        resolved_models: {
          strongest: {
            implementation: {model: null, reason: 'no-compatible-model'},
          },
        },
      },
    });
  });

  test('returns no-compatible-model for every role when the workspace has no models', async () => {
    const integrations = integrationClient([connection('linear-main', 'linear')]);
    integrations.resolveConnectionById.mockResolvedValue({
      id: sourceConnectionId,
      provider: 'github',
      slug: 'github-project',
      displayName: 'Project GitHub',
      lifecycleStatus: 'active',
    });
    const response = await getTool(
      createTools(integrations, projectClient(), agentClient([])),
      'get_workflow_template',
    ).execute({
      context,
      arguments: {template_id: 'fixture-template', project_id: projectId, tracker: 'linear'},
    });

    expect(response).toMatchObject({
      ok: true,
      result: {
        resolved_models: {
          balanced: {
            mechanical: {model: null, reason: 'no-compatible-model'},
            implementation: {model: null, reason: 'no-compatible-model'},
            review: {model: null, reason: 'no-compatible-model'},
          },
        },
      },
    });
  });

  test('composes an open role and resolves the source from the project', async () => {
    const integrations = integrationClient([connection('linear-main', 'linear')]);
    integrations.resolveConnectionById.mockResolvedValue({
      id: sourceConnectionId,
      provider: 'github',
      slug: 'github-project',
      displayName: 'Project GitHub',
      lifecycleStatus: 'active',
    });
    const projects = {
      requireProjectForWorkspace: vi.fn().mockResolvedValue({project: {sourceConnectionId}}),
    } as unknown as ProjectsModuleClient;
    const tools = createTools(integrations, projects);
    const get = getTool(tools, 'get_workflow_template');

    const response = await get.execute({
      context,
      arguments: {template_id: 'fixture-template', project_id: projectId, tracker: 'linear'},
    });

    expect(integrations.resolveConnectionById).toHaveBeenCalledWith({
      connectionId: sourceConnectionId,
    });
    expect(response).toMatchObject({
      ok: true,
      result: {
        template_id: 'fixture-template',
        options: [{id: 'mode'}],
        workflow_yaml: expect.stringContaining('source: linear'),
        guide_markdown: '# Follow this fixture',
        suggested_bindings: {tracker: ['linear-main'], source: ['github-project']},
      },
    });
    expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
    if (!response.ok) throw new Error('Expected a successful template response');
    expect(getWorkflowTemplateResultSchema.safeParse(response.result).success).toBe(true);
  });

  test.each([
    {
      arguments: {template_id: 'missing', project_id: projectId, tracker: 'linear'},
      code: 'not-found',
    },
    {arguments: {template_id: 'fixture-template', project_id: projectId}, code: 'invalid-request'},
    {
      arguments: {template_id: 'fixture-template', project_id: projectId, source: 'github'},
      code: 'invalid-request',
    },
    {
      arguments: {template_id: 'fixture-template', project_id: projectId, tracker: 'unknown'},
      code: 'invalid-request',
    },
  ])('returns $code for invalid template selection', async ({arguments: input, code}) => {
    const integrations = integrationClient([]);
    const projects = {
      requireProjectForWorkspace: vi.fn().mockResolvedValue({project: {sourceConnectionId}}),
    } as unknown as ProjectsModuleClient;
    const response = await getTool(
      createTools(integrations, projects),
      'get_workflow_template',
    ).execute({
      context,
      arguments: input,
    });

    expect(response).toEqual({ok: false, error: {code}});
  });

  test('advertises open-role inputs as dynamic provider properties', () => {
    expect(getWorkflowTemplateInputJsonSchema.additionalProperties).toEqual({
      type: 'string',
      minLength: 1,
    });
  });
});

function createTools(
  integrations: IntegrationsModuleClient,
  projects?: ProjectsModuleClient,
  agent?: AgentInterModuleClient,
) {
  return createAgentAccessTemplateTools({
    agent: agent ?? agentClient([{id: 'claude-opus-5', provider: 'anthropic'}]),
    integrations,
    projects:
      projects ?? ({requireProjectForWorkspace: vi.fn()} as unknown as ProjectsModuleClient),
    templates: createTemplateLoader([asset], setupGuide),
  });
}

function projectClient() {
  return {
    requireProjectForWorkspace: vi.fn().mockResolvedValue({project: {sourceConnectionId}}),
  } as unknown as ProjectsModuleClient;
}

function agentClient(
  models: readonly {id: string; provider: string}[],
  defaultModel: {id: string; provider: string} | null = models[0] ?? null,
) {
  return {
    getWorkspaceModels: vi.fn().mockResolvedValue({models, default_model: defaultModel}),
  } as unknown as AgentInterModuleClient;
}

function getTool(
  tools: readonly ReturnType<typeof createAgentAccessTemplateTools>[number][],
  name: string,
) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

function integrationClient(connections: readonly ReturnType<typeof connection>[]) {
  return {
    listConnectionsByWorkspace: vi.fn().mockResolvedValue({connections, nextCursor: null}),
    resolveConnectionById: vi.fn(),
  } as unknown as IntegrationsModuleClient & {
    listConnectionsByWorkspace: ReturnType<typeof vi.fn>;
    resolveConnectionById: ReturnType<typeof vi.fn>;
  };
}

function connection(
  slug: string,
  provider: string,
): {
  id: string;
  slug: string;
  provider: string;
  displayName: string;
  lifecycleStatus: 'active' | 'disabled' | 'error';
  capabilities: ['source_control'];
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: crypto.randomUUID(),
    slug,
    provider,
    displayName: provider,
    lifecycleStatus: 'active' as const,
    capabilities: ['source_control' as const],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}
