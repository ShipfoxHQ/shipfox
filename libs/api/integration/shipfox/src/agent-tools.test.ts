import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {encodeStringIdCursor, encodeTimestampIdCursor} from '@shipfox/node-drizzle';
import {
  createShipfoxAgentToolsProvider,
  SHIPFOX_INPUTS_MAX_BYTES,
  shipfoxAgentToolCatalog,
} from './agent-tools.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const parentRunId = '00000000-0000-4000-8000-000000000004';
const childRunId = '00000000-0000-4000-8000-000000000005';
const definitionId = '00000000-0000-4000-8000-000000000006';

function caller(overrides: Record<string, unknown> = {}) {
  return {
    callerKind: 'tool_step' as const,
    workspaceId,
    projectId,
    runId: parentRunId,
    jobExecutionId: '00000000-0000-4000-8000-000000000007',
    stepId: 'start-child',
    stepAttempt: 2,
    ...overrides,
  };
}

function createKnownError(code: string): Error {
  if (code === 'definition-not-found') {
    return createInterModuleKnownError(
      definitionsInterModuleContract.methods.getDefinitionByConfigPath,
      code,
      {projectId, configPath: 'child.yml'},
    );
  }
  if (code === 'manual-trigger-not-found') {
    return createInterModuleKnownError(
      triggersInterModuleContract.methods.fireManualTrigger,
      code,
      {definitionId},
    );
  }
  if (code === 'admission-denied') {
    return createInterModuleKnownError(
      triggersInterModuleContract.methods.fireManualTrigger,
      code,
      {workspaceId, reason: 'quota'},
    );
  }
  return createInterModuleKnownError(
    triggersInterModuleContract.methods.fireManualTrigger,
    code as 'run-depth-exceeded' | 'run-tree-limit-exceeded',
    {},
  );
}

function createProvider() {
  const definitions = {
    getDefinitionByConfigPath: vi.fn().mockResolvedValue({
      definitionId,
      workflowId: '00000000-0000-4000-8000-000000000008',
      name: 'Deploy',
    }),
    listDefinitionsByProject: vi.fn(),
  };
  const projects = {
    listProjectsByWorkspace: vi.fn(),
    requireProjectForWorkspace: vi.fn(),
  };
  const triggers = {
    fireManualTrigger: vi.fn().mockResolvedValue({
      id: childRunId,
      name: 'Deploy',
      deduplicated: false,
    }),
  };
  const workflows = {
    listWorkflowRuns: vi.fn(),
    listWorkflowRunJobs: vi.fn(),
    getWorkflowJobDetail: vi.fn(),
    getWorkflowRunOverview: vi.fn().mockResolvedValue({
      run: {number: 42},
    }),
  };
  const provider = createShipfoxAgentToolsProvider({definitions, projects, triggers, workflows});
  return {definitions, projects, triggers, workflows, provider};
}

describe('Shipfox agent tools', () => {
  it('has exactly the start_workflow_run catalog entry', () => {
    expect(shipfoxAgentToolCatalog.map((tool) => tool.id)).toEqual([
      'start_workflow_run',
      'list_projects',
      'list_workflow_definitions',
      'list_workflow_runs',
      'get_workflow_run',
    ]);
    expect('methods' in (shipfoxAgentToolCatalog[0] ?? {})).toBe(false);
    expect(shipfoxAgentToolCatalog[0]?.outputSchema).toMatchObject({
      additionalProperties: false,
      required: ['run_id', 'run_number', 'name', 'project_id', 'deduplicated'],
    });
  });

  it('describes producer-shaped workflow result fields in the catalog', () => {
    const definitionsTool = shipfoxAgentToolCatalog.find(
      (tool) => tool.id === 'list_workflow_definitions',
    );
    const getWorkflowRunTool = shipfoxAgentToolCatalog.find(
      (tool) => tool.id === 'get_workflow_run',
    );

    expect(definitionsTool?.outputSchema).toMatchObject({
      properties: {
        definitions: {
          items: {
            additionalProperties: false,
            properties: {has_manual_trigger: {type: 'boolean'}},
            required: expect.arrayContaining(['has_manual_trigger']),
          },
        },
      },
    });
    expect(getWorkflowRunTool?.outputSchema).toMatchObject({
      properties: {
        attempt: {
          type: 'object',
          additionalProperties: false,
          required: expect.arrayContaining([
            'id',
            'workflow_run_id',
            'attempt',
            'status',
            'created_at',
            'started_at',
            'finished_at',
            'rerun_mode',
          ]),
          properties: {
            concurrency: {
              anyOf: [
                expect.objectContaining({type: 'object', additionalProperties: false}),
                {type: 'null'},
              ],
            },
          },
        },
        jobs: {
          items: {
            properties: {
              execution_count: {
                anyOf: [{type: 'integer', minimum: 0, maximum: 100}, {const: '100+'}],
              },
            },
          },
        },
      },
    });
  });

  it('uses the caller project by default and starts a child with its parent', async () => {
    const {definitions, triggers, workflows, provider} = createProvider();
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    await expect(
      session.call({toolId: 'start_workflow_run', arguments: {workflow: '.shipfox/child.yml'}}),
    ).resolves.toMatchObject({
      structuredContent: {
        run_id: childRunId,
        run_number: 42,
        name: 'Deploy',
        project_id: projectId,
        deduplicated: false,
      },
    });
    expect(definitions.getDefinitionByConfigPath).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      configPath: '.shipfox/child.yml',
    });
    expect(triggers.fireManualTrigger).toHaveBeenCalledWith({
      workspaceId,
      definitionId,
      parentRun: {runId: parentRunId},
      idempotencyKey: `${parentRunId}:start-child:2`,
    });
    expect(workflows.getWorkflowRunOverview).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: childRunId,
    });
  });

  it('uses an explicit project and passes inputs', async () => {
    const {definitions, triggers, provider} = createProvider();
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });
    const explicitProject = '00000000-0000-4000-8000-000000000009';

    const result = await session.call({
      toolId: 'start_workflow_run',
      arguments: {workflow: 'child.yml', project_id: explicitProject, inputs: {version: '1.2.3'}},
    });

    expect(result).toMatchObject({structuredContent: {project_id: explicitProject}});
    expect(definitions.getDefinitionByConfigPath).toHaveBeenCalledWith(
      expect.objectContaining({projectId: explicitProject}),
    );
    expect(triggers.fireManualTrigger).toHaveBeenCalledWith(
      expect.objectContaining({inputs: {version: '1.2.3'}}),
    );
    expect(projectId).not.toBe(explicitProject);
  });

  it.each([
    'definition-not-found',
    'manual-trigger-not-found',
    'run-depth-exceeded',
    'run-tree-limit-exceeded',
    'admission-denied',
  ] as const)('maps %s to a tool error', async (code) => {
    const {definitions, triggers, provider} = createProvider();
    const knownError = createKnownError(code);
    if (code === 'definition-not-found')
      definitions.getDefinitionByConfigPath.mockRejectedValue(knownError);
    else triggers.fireManualTrigger.mockRejectedValue(knownError);

    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });
    const result = await session.call({
      toolId: 'start_workflow_run',
      arguments: {workflow: 'child.yml'},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code}});
  });

  it.each([
    'definition-not-found',
    'parent-run-not-found',
  ] as const)('maps forwarded %s to a tool error', async (code) => {
    const {triggers, provider} = createProvider();
    const knownError =
      code === 'definition-not-found'
        ? createInterModuleKnownError(
            triggersInterModuleContract.methods.fireManualTrigger,
            'definition-not-found',
            {definitionId},
          )
        : createInterModuleKnownError(
            triggersInterModuleContract.methods.fireManualTrigger,
            'parent-run-not-found',
            {},
          );
    triggers.fireManualTrigger.mockRejectedValue(knownError);

    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });
    const result = await session.call({
      toolId: 'start_workflow_run',
      arguments: {workflow: 'child.yml'},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code}});
  });

  it('namespaces an agent idempotency key by the parent run', async () => {
    const {triggers, provider} = createProvider();
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller({callerKind: 'agent'}),
    });

    await session.call({
      toolId: 'start_workflow_run',
      arguments: {workflow: 'child.yml', idempotency_key: 'same-child'},
    });

    expect(triggers.fireManualTrigger).toHaveBeenCalledWith(
      expect.objectContaining({idempotencyKey: `${parentRunId}:same-child`}),
    );
  });

  it('uses a new key for an agent call without a supplied key', async () => {
    const {triggers, provider} = createProvider();
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller({callerKind: 'agent'}),
    });

    await session.call({toolId: 'start_workflow_run', arguments: {workflow: 'child.yml'}});

    expect(triggers.fireManualTrigger.mock.calls[0]?.[0].idempotencyKey).toEqual(
      expect.any(String),
    );
    expect(triggers.fireManualTrigger.mock.calls[0]?.[0].idempotencyKey).not.toBe(
      `${parentRunId}:same-child`,
    );
  });

  it('rejects a caller without a caller kind', async () => {
    const {definitions, provider} = createProvider();
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller({callerKind: undefined}),
    });

    const result = await session.call({
      toolId: 'start_workflow_run',
      arguments: {workflow: 'child.yml'},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'invalid-request'}});
    expect(definitions.getDefinitionByConfigPath).not.toHaveBeenCalled();
  });

  it('rejects inputs above the UTF-8 byte limit before resolving the definition', async () => {
    const {definitions, provider} = createProvider();
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });
    const result = await session.call({
      toolId: 'start_workflow_run',
      arguments: {workflow: 'child.yml', inputs: {value: 'x'.repeat(SHIPFOX_INPUTS_MAX_BYTES)}},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'invalid-request'}});
    expect(definitions.getDefinitionByConfigPath).not.toHaveBeenCalled();
  });

  it('lists projects with the producer cursor and maps the closed result', async () => {
    const {projects, provider} = createProvider();
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    projects.listProjectsByWorkspace.mockResolvedValue({
      projects: [{id: projectId, name: 'Build project'}],
      nextCursor: {createdAt, id: projectId},
    });
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    const result = await session.call({
      toolId: 'list_projects',
      arguments: {limit: 10, cursor: encodeTimestampIdCursor({createdAt, id: parentRunId})},
    });

    expect(projects.listProjectsByWorkspace).toHaveBeenCalledWith({
      workspaceId,
      limit: 10,
      cursor: {createdAt: createdAt.toISOString(), id: parentRunId},
    });
    expect(result.structuredContent).toEqual({
      projects: [{id: projectId, name: 'Build project'}],
      next_cursor: encodeTimestampIdCursor({createdAt, id: projectId}),
    });
  });

  it('lists definitions for an explicit project and pages by name and id', async () => {
    const {definitions, projects, provider} = createProvider();
    const otherProjectId = '00000000-0000-4000-8000-000000000009';
    projects.requireProjectForWorkspace.mockResolvedValue({project: {id: otherProjectId}});
    definitions.listDefinitionsByProject.mockResolvedValue({
      definitions: [
        {
          id: definitionId,
          name: 'Deploy',
          configPath: '.shipfox/deploy.yml',
          manualTrigger: {name: 'manual'},
        },
      ],
      sync: null,
      nextCursor: {value: 'Deploy', id: definitionId},
    });
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    const result = await session.call({
      toolId: 'list_workflow_definitions',
      arguments: {
        project_id: otherProjectId,
        limit: 20,
        cursor: encodeStringIdCursor({value: 'Build', id: parentRunId}),
      },
    });

    expect(projects.requireProjectForWorkspace).toHaveBeenCalledWith({
      workspaceId,
      projectId: otherProjectId,
    });
    expect(definitions.listDefinitionsByProject).toHaveBeenCalledWith({
      workspaceId,
      projectId: otherProjectId,
      limit: 20,
      cursor: {value: 'Build', id: parentRunId},
    });
    expect(result.structuredContent).toMatchObject({
      definitions: [
        {
          id: definitionId,
          name: 'Deploy',
          config_path: '.shipfox/deploy.yml',
          has_manual_trigger: true,
        },
      ],
      next_cursor: encodeStringIdCursor({value: 'Deploy', id: definitionId}),
    });
  });

  it('resolves a workflow path and filters workflow runs using the caller project by default', async () => {
    const {definitions, projects, provider, workflows} = createProvider();
    projects.requireProjectForWorkspace.mockResolvedValue({project: {id: projectId}});
    workflows.listWorkflowRuns.mockResolvedValue({
      runs: [],
      nextCursor: null,
      filteredTotalCount: 0,
    });
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    await session.call({
      toolId: 'list_workflow_runs',
      arguments: {
        workflow: '.shipfox/nightly.yml',
        status: 'failed',
        created_from: '2026-01-01T00:00:00.000Z',
        created_to: '2026-01-02T00:00:00.000Z',
      },
    });

    expect(definitions.getDefinitionByConfigPath).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      configPath: '.shipfox/nightly.yml',
    });
    expect(workflows.listWorkflowRuns).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      limit: 50,
      filters: {
        definitionId,
        status: 'failed',
        createdFrom: '2026-01-01T00:00:00.000Z',
        createdTo: '2026-01-02T00:00:00.000Z',
      },
    });
  });

  it.each([
    '2026-01-01',
    'January 1, 2026',
    '2026-01-01T00:00:00.000+00:00',
  ] as const)('rejects non-ISO date-time filters before listing runs: %s', async (createdFrom) => {
    const {provider, workflows} = createProvider();
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    const result = await session.call({
      toolId: 'list_workflow_runs',
      arguments: {created_from: createdFrom},
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {code: 'invalid-request'},
    });
    expect(workflows.listWorkflowRuns).not.toHaveBeenCalled();
  });

  it.each([
    1,
    '100+',
  ] as const)('gets a run with at most 50 jobs and reports truncation for execution count %s', async (executionCount) => {
    const {projects, provider, workflows} = createProvider();
    projects.requireProjectForWorkspace.mockResolvedValue({project: {id: projectId}});
    workflows.getWorkflowRunOverview.mockResolvedValue({
      run: {
        id: childRunId,
        project_id: projectId,
        definition_id: definitionId,
        number: 7,
        name: 'Nightly',
        workflow_name: 'Nightly',
        origin: 'synced',
        dev_source: null,
        trigger_provider: 'manual',
        trigger_source: 'manual',
        trigger_event: 'fire',
        trigger_reference: null,
        parent_run: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      attempt: {
        id: parentRunId,
        workflow_run_id: childRunId,
        attempt: 1,
        status: 'failed',
        created_at: '2026-01-01T00:00:00.000Z',
        started_at: null,
        finished_at: null,
        rerun_mode: null,
      },
      has_started_job_execution: false,
      jobs: {kind: 'complete', total: 1, items: []},
    });
    const job = {
      id: definitionId,
      key: 'build',
      name: 'Build',
      position: 0,
      status: 'failed',
      status_reason: null,
      mode: 'run',
      listener_status: 'none',
      carried_over: false,
      execution_count: executionCount,
      execution_status_counts: {},
      default_execution: null,
    };
    workflows.listWorkflowRunJobs.mockResolvedValue({
      workflow_run_attempt: 1,
      items: [job],
      nextCursor: 'more',
      total: 51,
    });
    workflows.getWorkflowJobDetail.mockResolvedValue({
      workflow_run_id: childRunId,
      workflow_run_attempt: 1,
      job,
      selected_execution: null,
    });
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    const result = await session.call({
      toolId: 'get_workflow_run',
      arguments: {run_id: childRunId},
    });

    expect(workflows.listWorkflowRunJobs).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: childRunId,
      attempt: 1,
      limit: 50,
    });
    expect(workflows.getWorkflowJobDetail).toHaveBeenCalledWith({workspaceId, jobId: definitionId});
    expect(result.structuredContent).toMatchObject({
      jobs_truncated: true,
      jobs: [{id: definitionId, execution_count: executionCount}],
    });
  });

  it('maps a project from another workspace to a not-found tool error', async () => {
    const {projects, provider} = createProvider();
    projects.requireProjectForWorkspace.mockRejectedValue(
      createInterModuleKnownError(
        projectsInterModuleContract.methods.requireProjectForWorkspace,
        'project-workspace-mismatch',
        {projectId, workspaceId},
      ),
    );
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    const result = await session.call({
      toolId: 'list_workflow_definitions',
      arguments: {project_id: projectId},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'not-found'}});
  });
});
