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
import {
  createTemplateLoader,
  type WorkflowTemplateAsset,
  workflowTemplateManifestSchema,
} from '@shipfox/workflow-templates';
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
    models: {},
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
describe('agent-access template tools', () => {
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

  test('returns per-placeholder suggestions with the exact binding settings', async () => {
    const integrations = integrationClient([connection('linear-main', 'linear')]);
    integrations.resolveConnectionById.mockResolvedValue({
      id: sourceConnectionId,
      provider: 'github',
      slug: 'github-project',
      displayName: 'Project GitHub',
      lifecycleStatus: 'active',
    });
    const testedModel = {
      id: 'tested',
      provider: 'anthropic',
      harness: 'pi',
      thinking: 'medium',
      supported_thinking: ['medium', 'default'],
      is_default: true,
      price: null,
      references: [
        {thinking: 'medium', intelligence_index: 80, cost_per_task_usd: 4, scale: 'coding-v1'},
      ],
    };
    const cheaperModel = {
      id: 'cheaper',
      provider: 'openai',
      harness: 'pi',
      thinking: 'high',
      supported_thinking: ['high', 'default'],
      is_default: false,
      price: {input: 1, output: 2},
      references: [
        {thinking: 'high', intelligence_index: 81, cost_per_task_usd: 2, scale: 'coding-v1'},
        {thinking: 'default', intelligence_index: 80, cost_per_task_usd: 1, scale: 'coding-v1'},
      ],
    };
    const agent = {
      getWorkspaceModels: vi.fn().mockResolvedValue({
        models: [testedModel, cheaperModel],
        default_model: testedModel,
        attribution: 'Benchmark source',
      }),
    } as unknown as AgentInterModuleClient;
    const templateAsset = {
      ...asset,
      manifest: {
        ...workflowTemplateManifestSchema.parse(asset.manifest),
        models: {
          fix: {
            reference: {model: 'tested', thinking: 'medium' as const},
            note: 'Confirm this setting.',
          },
        },
      },
      workflow:
        'name: fixture\ntriggers:\n  # part:tracker.trigger\njobs:\n  fix:\n    steps:\n      - model: tested # model:fix\n        thinking: medium',
      parts: {
        ...asset.parts,
        tracker: {
          linear: {trigger: 'source: linear\nevent: issue.created'},
          github: {trigger: 'source: github\nevent: issues.opened'},
        },
      },
    };
    const get = getTool(
      createTools(integrations, projectClient(), agent, templateAsset),
      'get_workflow_template',
    );

    const response = await get.execute({
      context,
      arguments: {template_id: 'fixture-template', project_id: projectId, tracker: 'linear'},
    });

    expect(response).toMatchObject({
      ok: true,
      result: {
        suggested_models: {
          fix: {
            reference: {model: 'tested', thinking: 'medium', intelligence_index: 80},
            note: 'Confirm this setting.',
            outcome: 'suggested',
            models: [
              {
                id: 'cheaper',
                provider: 'openai',
                harness: 'pi',
                thinking: 'default',
                reference: {cost_per_task_usd: 1},
              },
              {id: 'cheaper', thinking: 'high'},
              {id: 'tested', thinking: 'medium', is_default: true},
              {id: 'tested', thinking: 'default', reference: null},
            ],
            attribution: 'Benchmark source',
          },
        },
      },
    });
    expect(get.description).toContain('Bind the confirmed provider, model, harness, and thinking');
    if (!response.ok) throw new Error('Expected a successful template response');
    expect(getWorkflowTemplateResultSchema.safeParse(response.result).success).toBe(true);
  });

  test('returns an empty suggestion map when the template has no model placeholders', async () => {
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

    expect(response).toMatchObject({ok: true, result: {suggested_models: {}}});
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
  templateAsset: WorkflowTemplateAsset = asset,
) {
  return createAgentAccessTemplateTools({
    agent: agent ?? agentClient([{id: 'claude-opus-5', provider: 'anthropic'}]),
    integrations,
    projects:
      projects ?? ({requireProjectForWorkspace: vi.fn()} as unknown as ProjectsModuleClient),
    templates: createTemplateLoader([templateAsset]),
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
  const workspaceModels = models.map((model) => ({
    ...model,
    harness: 'pi' as const,
    thinking: 'medium' as const,
    supported_thinking: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const,
    is_default:
      defaultModel !== null &&
      model.id === defaultModel.id &&
      model.provider === defaultModel.provider,
    price: null,
    references: [],
  }));
  const workspaceDefaultModel =
    defaultModel === null
      ? null
      : (workspaceModels.find(
          ({id, provider}) => id === defaultModel.id && provider === defaultModel.provider,
        ) ?? null);

  return {
    getWorkspaceModels: vi.fn().mockResolvedValue({
      models: workspaceModels,
      default_model: workspaceDefaultModel,
      attribution: null,
    }),
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
