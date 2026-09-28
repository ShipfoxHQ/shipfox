import {
  AGENT_ACCESS_RESPONSE_MAX_BYTES,
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
import {
  createTestAgentClient,
  scoredModel,
  TEST_ATTRIBUTION,
  workspaceModel,
} from '#test/fixtures/agent-models.js';
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
      report: {
        providers: ['slack'],
        optional: true,
        question: 'Should the workflow report to Slack?',
        tradeoff: 'Posts one Slack message per run.',
      },
    },
    options: [{id: 'mode', choices: [{id: 'safe', default: true}]}],
    models: {},
    slots: [],
    secrets: [],
    variables: [],
  },
  workflow: 'name: fixture\ntriggers:\n  # part:tracker.trigger\n  # part:report.trigger\njobs: {}',
  guide: '# Follow this fixture',
  parts: {
    tracker: {
      linear: {trigger: '- source: linear\n  event: issue.created'},
      github: {trigger: '- source: github\n  event: issues.opened'},
    },
    source: {github: {unused: 'unused'}},
    report: {slack: {trigger: '- source: slack\n  event: app_mention'}},
  } as unknown as WorkflowTemplateAsset['parts'],
};
describe('agent-access template tools', () => {
  test('lists compatibility from required roles and active connection suggestions per provider', async () => {
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
                from_project: false,
                optional: false,
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
                from_project: true,
                optional: false,
                providers: [
                  {
                    provider: 'github',
                    compatible: true,
                    suggested_bindings: ['github-main', 'github-secondary'],
                  },
                ],
              },
              {
                role: 'report',
                from_project: false,
                optional: true,
                question: 'Should the workflow report to Slack?',
                tradeoff: 'Posts one Slack message per run.',
                providers: [{provider: 'slack', compatible: false, suggested_bindings: []}],
              },
            ],
          }),
        ],
      },
    });
    if (!response.ok) throw new Error('Expected a successful list response');
    expect(listWorkflowTemplatesResultSchema.safeParse(response.result).success).toBe(true);
  });

  test('returns model recommendations grouped by the tested binding', async () => {
    const integrations = integrationClient([connection('linear-main', 'linear')]);
    integrations.resolveConnectionById.mockResolvedValue(projectSource('github'));
    const agent = createTestAgentClient({
      models: [
        scoredModel({
          id: 'tested',
          provider: 'shipfox',
          lab: 'Anthropic',
          thinking: 'medium',
          index: 80,
          cost: 4,
        }),
        scoredModel({
          id: 'cheaper',
          provider: 'shipfox',
          lab: 'OpenAI',
          thinking: 'high',
          index: 79,
          cost: 1,
        }),
      ],
      runtimeProvider: 'shipfox',
      managedProviderId: 'shipfox',
    });
    const get = getTool(
      createTools(integrations, projectClient(), agent, modelTemplateAsset()),
      'get_workflow_template',
    );

    const response = await get.execute({
      context,
      arguments: {template_id: 'fixture-template', project_id: projectId, tracker: 'linear'},
    });

    expect(response).toMatchObject({
      ok: true,
      result: {
        model_recommendations: [
          {
            placeholders: ['fix', 'review'],
            notes: {fix: 'Confirm this setting.'},
            mode: 'recommended',
            choices: [
              {model: 'tested', provider: 'shipfox', is_anchor: true, provider_required: false},
              {
                model: 'cheaper',
                thinking: 'high',
                tradeoff: {intelligence: 'similar', cost: 'much_cheaper'},
              },
            ],
            attribution: TEST_ATTRIBUTION,
          },
        ],
      },
    });
    expect(get.description).toContain('provider_required');
    expect(get.description).toContain('`choose` when neither default is available');
    expect(get.description).toContain('set a workspace default under Settings > Agents');
    expect(get.description).toContain('Do not ask users to compare models during setup');
    if (!response.ok) throw new Error('Expected a successful template response');
    expect(getWorkflowTemplateResultSchema.safeParse(response.result).success).toBe(true);
  });

  test('keeps the response far under the ceiling with an OpenRouter-sized catalog', async () => {
    const integrations = integrationClient([connection('linear-main', 'linear')]);
    integrations.resolveConnectionById.mockResolvedValue(projectSource('github'));
    const labs = ['Anthropic', 'OpenAI', 'Google', 'DeepSeek', 'Z.ai', 'Moonshot AI', 'Alibaba'];
    const models = Array.from({length: 346}, (_, index) =>
      workspaceModel({
        id: index === 0 ? 'tested' : `vendor/model-${index}-with-a-long-catalog-identifier`,
        provider: 'shipfox',
        label: `Model ${index} with a long display label`,
        lab: labs[index % labs.length] ?? null,
        price: {input: 1, output: 2},
        references: (['low', 'medium', 'high', 'xhigh', 'max'] as const).map((thinking, level) => ({
          thinking,
          intelligence_index: 70 + ((index + level) % 20),
          cost_per_task_usd: 0.1 * ((index % 30) + level + 1),
          scale: 'coding-v1',
        })),
      }),
    );
    const agent = createTestAgentClient({
      models,
      runtimeProvider: 'shipfox',
      managedProviderId: 'shipfox',
      defaultModel: {id: 'tested', provider: 'shipfox'},
    });
    const template = modelTemplateAsset({reply: 'vendor/model-7-with-a-long-catalog-identifier'});

    const response = await getTool(
      createTools(integrations, projectClient(), agent, template),
      'get_workflow_template',
    ).execute({
      context,
      arguments: {template_id: 'fixture-template', project_id: projectId, tracker: 'linear'},
    });

    if (!response.ok) throw new Error('Expected a successful template response');
    const result = getWorkflowTemplateResultSchema.parse(response.result);
    expect(result.model_recommendations.map(({mode}) => mode)).toEqual([
      'recommended',
      'recommended',
    ]);
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(
      AGENT_ACCESS_RESPONSE_MAX_BYTES / 8,
    );
  });

  test('returns no recommendation groups when the template has no model placeholders', async () => {
    const integrations = integrationClient([connection('linear-main', 'linear')]);
    integrations.resolveConnectionById.mockResolvedValue(projectSource('github'));
    const response = await getTool(
      createTools(integrations, projectClient()),
      'get_workflow_template',
    ).execute({
      context,
      arguments: {template_id: 'fixture-template', project_id: projectId, tracker: 'linear'},
    });

    expect(response).toMatchObject({ok: true, result: {model_recommendations: []}});
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

  test('composes an optional role only when it is passed', async () => {
    const integrations = integrationClient([
      connection('linear-main', 'linear'),
      connection('slack-main', 'slack'),
    ]);
    integrations.resolveConnectionById.mockResolvedValue(projectSource('github'));
    const get = getTool(createTools(integrations, projectClient()), 'get_workflow_template');
    const input = {template_id: 'fixture-template', project_id: projectId, tracker: 'linear'};

    const without = await get.execute({context, arguments: input});
    const withReport = await get.execute({context, arguments: {...input, report: 'slack'}});

    if (!without.ok || !withReport.ok) throw new Error('Expected successful template responses');
    const omitted = getWorkflowTemplateResultSchema.parse(without.result);
    const chosen = getWorkflowTemplateResultSchema.parse(withReport.result);
    expect(omitted.workflow_yaml).toContain(
      '# shipfox-template: fixture-template@1 tracker=linear source=github',
    );
    expect(omitted.workflow_yaml).not.toContain('source: slack');
    expect(omitted.suggested_bindings).toEqual({
      tracker: ['linear-main'],
      source: ['github-project'],
    });
    expect(chosen.workflow_yaml).toContain(
      '# shipfox-template: fixture-template@1 tracker=linear source=github report=slack',
    );
    expect(chosen.workflow_yaml).toContain('source: slack');
    expect(chosen.suggested_bindings).toEqual({
      tracker: ['linear-main'],
      source: ['github-project'],
      report: ['slack-main'],
    });
  });

  test('accepts a project role that matches the project source', async () => {
    const integrations = integrationClient([connection('linear-main', 'linear')]);
    integrations.resolveConnectionById.mockResolvedValue(projectSource('github'));

    const response = await getTool(
      createTools(integrations, projectClient()),
      'get_workflow_template',
    ).execute({
      context,
      arguments: {
        template_id: 'fixture-template',
        project_id: projectId,
        tracker: 'linear',
        source: 'github',
      },
    });

    expect(response).toMatchObject({
      ok: true,
      result: {suggested_bindings: {tracker: ['linear-main'], source: ['github-project']}},
    });
  });

  test.each([
    {
      name: 'an unknown template',
      arguments: {template_id: 'missing', project_id: projectId, tracker: 'linear'},
      error: {
        code: 'not-found',
        message: 'Unknown template_id "missing". Call list_workflow_templates for template IDs.',
      },
    },
    {
      name: 'a missing open role',
      arguments: {template_id: 'fixture-template', project_id: projectId},
      error: {
        code: 'invalid-request',
        message:
          'Missing role "tracker". Pass each open role as `<role>: <provider ID>`: tracker (linear or github). Pass an optional role only when the user chose it: report (slack). The project sets source.',
      },
    },
    {
      name: 'a connection slug instead of a provider ID',
      arguments: {template_id: 'fixture-template', project_id: projectId, tracker: 'linear-main'},
      error: {
        code: 'invalid-request',
        message:
          'Role "tracker" takes a provider ID (linear or github), not "linear-main". Choose connection slugs later from suggested_bindings.',
      },
    },
    {
      name: 'an unknown input',
      arguments: {
        template_id: 'fixture-template',
        project_id: projectId,
        tracker_provider: 'linear',
      },
      error: {
        code: 'invalid-request',
        message:
          'Unknown input "tracker_provider". Pass each open role as `<role>: <provider ID>`: tracker (linear or github). Pass an optional role only when the user chose it: report (slack). The project sets source.',
      },
    },
  ])('explains $name', async ({arguments: input, error}) => {
    const response = await getTool(
      createTools(integrationClient([]), projectClient()),
      'get_workflow_template',
    ).execute({context, arguments: input});

    expect(response).toEqual({ok: false, error});
  });

  test('rejects a project role that differs from the project source', async () => {
    const integrations = integrationClient([]);
    integrations.resolveConnectionById.mockResolvedValue(projectSource('github'));

    const response = await getTool(
      createTools(integrations, projectClient()),
      'get_workflow_template',
    ).execute({
      context,
      arguments: {
        template_id: 'fixture-template',
        project_id: projectId,
        tracker: 'linear',
        source: 'gitlab',
      },
    });

    expect(response).toEqual({
      ok: false,
      error: {
        code: 'invalid-request',
        message: 'Role "source" is set from the project, which uses "github". Omit "source".',
      },
    });
  });

  test('explains a project source the template does not support', async () => {
    const integrations = integrationClient([]);
    integrations.resolveConnectionById.mockResolvedValue(projectSource('gitlab'));

    const response = await getTool(
      createTools(integrations, projectClient()),
      'get_workflow_template',
    ).execute({
      context,
      arguments: {template_id: 'fixture-template', project_id: projectId, tracker: 'linear'},
    });

    expect(response).toEqual({
      ok: false,
      error: {
        code: 'invalid-request',
        message: 'This template needs a github project source, but the project uses "gitlab".',
      },
    });
  });

  test('composes a template without a project source role', async () => {
    const integrations = integrationClient([connection('slack-alerts', 'slack')]);
    const projects = projectClient();
    const notifyAsset: WorkflowTemplateAsset = {
      ...asset,
      manifest: {
        ...workflowTemplateManifestSchema.parse(asset.manifest),
        id: 'notify-template',
        roles: {notify: {providers: ['slack']}},
      },
      workflow: 'name: fixture\njobs:\n  notify:\n    steps:\n      # part:notify.send',
      parts: {notify: {slack: {send: '- tool: send_message\n  connection: slack'}}},
    };

    const response = await getTool(
      createTools(integrations, projects, undefined, notifyAsset),
      'get_workflow_template',
    ).execute({
      context,
      arguments: {template_id: 'notify-template', project_id: projectId, notify: 'slack'},
    });

    expect(projects.requireProjectForWorkspace).toHaveBeenCalledWith({workspaceId, projectId});
    expect(integrations.resolveConnectionById).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      ok: true,
      result: {
        workflow_yaml: expect.stringContaining('tool: send_message'),
        suggested_bindings: {notify: ['slack-alerts']},
      },
    });
    expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
    if (!response.ok) throw new Error('Expected a successful template response');
    expect(getWorkflowTemplateResultSchema.safeParse(response.result).success).toBe(true);
  });

  test('advertises open-role inputs as dynamic provider properties', () => {
    expect(getWorkflowTemplateInputJsonSchema.additionalProperties).toMatchObject({
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
    agent:
      agent ??
      createTestAgentClient({
        models: [workspaceModel({id: 'claude-opus-5', provider: 'anthropic'})],
        runtimeProvider: 'anthropic',
        defaultModel: {id: 'claude-opus-5', provider: 'anthropic'},
      }),
    integrations,
    projects:
      projects ?? ({requireProjectForWorkspace: vi.fn()} as unknown as ProjectsModuleClient),
    templates: createTemplateLoader([templateAsset]),
  });
}

function projectSource(provider: string) {
  return {
    id: sourceConnectionId,
    provider,
    slug: `${provider}-project`,
    displayName: 'Project source',
    lifecycleStatus: 'active',
  };
}

function projectClient() {
  return {
    requireProjectForWorkspace: vi.fn().mockResolvedValue({project: {sourceConnectionId}}),
  } as unknown as ProjectsModuleClient;
}

function modelTemplateAsset(models: {reply?: string} = {}): WorkflowTemplateAsset {
  return {
    ...asset,
    manifest: {
      ...workflowTemplateManifestSchema.parse(asset.manifest),
      models: {
        fix: {note: 'Confirm this setting.'},
        review: {},
        ...(models.reply === undefined ? {} : {reply: {}}),
      },
    },
    workflow: [
      'name: fixture',
      'jobs:',
      '  fix:',
      '    steps:',
      '      - key: fix',
      '        model: tested # model:fix',
      '        thinking: medium',
      '        prompt: Fix the issue.',
      '      - key: review',
      '        model: tested # model:review',
      '        thinking: medium',
      '        prompt: Review the fix.',
      ...(models.reply === undefined
        ? []
        : [
            '      - key: reply',
            `        model: ${models.reply} # model:reply`,
            '        thinking: low',
            '        prompt: Reply.',
          ]),
    ].join('\n'),
  };
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
