import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {STEP_LOG_READ_CONTENT_MAX_BYTES} from '@shipfox/api-logs-dto';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {
  encodeNumberIdCursor,
  encodeStringIdCursor,
  encodeTimestampIdCursor,
} from '@shipfox/node-drizzle';
import {Ajv} from 'ajv';
import {
  createShipfoxAgentToolsProvider,
  SHIPFOX_INPUTS_MAX_BYTES,
  shipfoxAgentToolCatalog,
  shipfoxAgentToolSelectionCatalog,
  shipfoxConversationToolCatalog,
} from './agent-tools.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const parentRunId = '00000000-0000-4000-8000-000000000004';
const childRunId = '00000000-0000-4000-8000-000000000005';
const definitionId = '00000000-0000-4000-8000-000000000006';
const stepId = '00000000-0000-4000-8000-000000000010';
const stepAttemptId = '00000000-0000-4000-8000-000000000011';
const jobId = '00000000-0000-4000-8000-000000000012';
const jobExecutionId = '00000000-0000-4000-8000-000000000013';
const annotationId = '00000000-0000-4000-8000-000000000014';

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

function conversationCaller(overrides: Record<string, unknown> = {}) {
  return {
    callerKind: 'conversation' as const,
    workspaceId,
    projectId,
    conversationId: '00000000-0000-4000-8000-000000000020',
    turnId: '00000000-0000-4000-8000-000000000021',
    callItemId: '00000000-0000-4000-8000-000000000022',
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
  if (code === 'secret-not-found') {
    return createInterModuleKnownError(
      triggersInterModuleContract.methods.fireManualTrigger,
      code,
      {key: 'MISSING_TOKEN'},
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
    getWorkflowStepAttemptDetail: vi.fn().mockResolvedValue({
      workflow_run_id: parentRunId,
      workflow_run_attempt: 1,
      job_id: jobId,
      job_execution_id: jobExecutionId,
      step_id: stepId,
      step_attempt_id: stepAttemptId,
      attempt: 2,
    }),
    listFailedStepAttempts: vi.fn().mockResolvedValue({
      workflow_run_attempt: 1,
      items: [],
    }),
    getLatestRunAttempt: vi.fn().mockResolvedValue({attempt: 1}),
  };
  const logs = {readStepLogTail: vi.fn().mockResolvedValue({content: 'step output'})};
  const annotations = {
    listAnnotationsForRunAttempt: vi.fn().mockResolvedValue({annotations: [], nextCursor: null}),
  };
  const provider = createShipfoxAgentToolsProvider({
    annotations,
    clientBaseUrl: 'https://app.example.test',
    definitions,
    logs,
    projects,
    triggers,
    workflows,
  });
  return {annotations, definitions, logs, projects, triggers, workflows, provider};
}

describe('Shipfox agent tools', () => {
  it('has the closed read and write catalog entries', () => {
    expect(shipfoxAgentToolCatalog.map((tool) => tool.id)).toEqual([
      'start_workflow_run',
      'list_projects',
      'list_workflow_definitions',
      'list_workflow_runs',
      'get_workflow_run',
      'get_step_logs',
      'get_run_annotations',
    ]);
    expect('methods' in (shipfoxAgentToolCatalog[0] ?? {})).toBe(false);
    expect(shipfoxAgentToolCatalog[0]?.inputSchema).toMatchObject({
      properties: {project_id: {type: 'string', pattern: expect.any(String)}},
    });
    expect(shipfoxAgentToolCatalog[0]?.inputSchema).not.toHaveProperty(
      'properties.project_id.format',
    );
    expect(shipfoxAgentToolCatalog[0]?.inputSchema).not.toHaveProperty('properties.secrets');
    expect(shipfoxAgentToolCatalog[0]?.outputSchema).toMatchObject({
      additionalProperties: false,
      required: ['run_id', 'run_number', 'name', 'project_id', 'url', 'deduplicated'],
    });
    expect(shipfoxAgentToolCatalog[1]?.sensitivity).toBe('read');
    expect(shipfoxAgentToolCatalog[1]?.outputSchema).toMatchObject({
      additionalProperties: false,
    });
    expect(shipfoxAgentToolCatalog[2]?.sensitivity).toBe('read');
    expect(shipfoxAgentToolCatalog[2]?.outputSchema).toMatchObject({
      additionalProperties: false,
    });
  });

  it('keeps the tool catalog and selection catalog deliberate', () => {
    expect(shipfoxAgentToolCatalog).toMatchSnapshot();
    expect(shipfoxAgentToolSelectionCatalog).toMatchSnapshot();
  });

  it('compiles every input schema with the strict validator tool steps use', () => {
    const ajv = new Ajv({strict: true, strictRequired: false});

    for (const tool of shipfoxAgentToolCatalog) {
      expect(() => ajv.compile(tool.inputSchema), tool.id).not.toThrow();
    }
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
        url: `https://app.example.test/runs/${childRunId}`,
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

  it('passes tool-step secret references using the parent project scope', async () => {
    const {triggers, provider} = createProvider();
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });
    const childProjectId = '00000000-0000-4000-8000-000000000009';

    await session.call({
      toolId: 'start_workflow_run',
      arguments: {
        workflow: 'child.yml',
        project_id: childProjectId,
        secrets: {DEPLOY_TOKEN: 'PROD_DEPLOY_TOKEN'},
      },
    });

    expect(triggers.fireManualTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        secretInputs: {
          DEPLOY_TOKEN: {key: 'PROD_DEPLOY_TOKEN', projectId},
        },
      }),
    );
    expect(triggers.fireManualTrigger.mock.calls[0]?.[0].secretInputs).not.toEqual({
      DEPLOY_TOKEN: {key: 'PROD_DEPLOY_TOKEN', projectId: childProjectId},
    });
  });

  it('passes an empty secret map instead of omitting it', async () => {
    const {triggers, provider} = createProvider();
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    await session.call({
      toolId: 'start_workflow_run',
      arguments: {workflow: 'child.yml', secrets: {}},
    });

    expect(triggers.fireManualTrigger).toHaveBeenCalledWith(
      expect.objectContaining({secretInputs: {}}),
    );
  });

  it.each([
    [{DEPLOY_TOKEN: 'invalid-name'}],
    [{invalid_name: 'PROD_TOKEN'}],
    [{A: 'A'.repeat(129)}],
    [{['A'.repeat(129)]: 'PROD_TOKEN'}],
    [Object.fromEntries(Array.from({length: 21}, (_, index) => [`TOKEN_${index}`, 'PROD_TOKEN']))],
  ])('validates secret names and map size', async (secrets) => {
    const {definitions, provider} = createProvider();
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    const result = await session.call({
      toolId: 'start_workflow_run',
      arguments: {workflow: 'child.yml', secrets},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'invalid-request'}});
    expect(definitions.getDefinitionByConfigPath).not.toHaveBeenCalled();
  });

  it('rejects secret references from agent callers before creating a run', async () => {
    const {definitions, triggers, provider} = createProvider();
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller({callerKind: 'agent'}),
    });

    const result = await session.call({
      toolId: 'start_workflow_run',
      arguments: {workflow: 'child.yml', secrets: {DEPLOY_TOKEN: 'PROD_DEPLOY_TOKEN'}},
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {code: 'secrets-not-allowed'},
    });
    expect(definitions.getDefinitionByConfigPath).not.toHaveBeenCalled();
    expect(triggers.fireManualTrigger).not.toHaveBeenCalled();
  });

  it('rejects malformed secret input from agent callers before validation', async () => {
    const {definitions, triggers, provider} = createProvider();
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller({callerKind: 'agent'}),
    });

    const result = await session.call({
      toolId: 'start_workflow_run',
      arguments: {workflow: 'child.yml', secrets: 'not-a-secret-map'},
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {code: 'secrets-not-allowed'},
    });
    expect(definitions.getDefinitionByConfigPath).not.toHaveBeenCalled();
    expect(triggers.fireManualTrigger).not.toHaveBeenCalled();
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

  it('maps a missing secret source to a named tool error', async () => {
    const {triggers, provider} = createProvider();
    triggers.fireManualTrigger.mockRejectedValue(createKnownError('secret-not-found'));
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    const result = await session.call({
      toolId: 'start_workflow_run',
      arguments: {workflow: 'child.yml', secrets: {DEPLOY_TOKEN: 'MISSING_TOKEN'}},
    });

    expect(result).toMatchObject({
      isError: true,
      content: [{text: 'Secret input source MISSING_TOKEN was not found'}],
      structuredContent: {code: 'secret-not-found', key: 'MISSING_TOKEN'},
    });
  });

  it('names the missing variable and where it is read', async () => {
    const {triggers, provider} = createProvider();
    triggers.fireManualTrigger.mockRejectedValue(
      createInterModuleKnownError(
        triggersInterModuleContract.methods.fireManualTrigger,
        'interpolation-unresolvable',
        {
          definitionId,
          field: 'env',
          source: 'vars.API_URL',
          envKey: 'URL',
          variableKey: 'API_URL',
          jobKey: 'deploy',
          step: {key: 'ship', index: 2},
        },
      ),
    );
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

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          text: 'Variable `API_URL` is not set. It is read in job `deploy`, step 2 (`ship`), field `env.URL`. Every variable a workflow references must exist, even in a branch that does not run. Define it in the workspace variables, then start the run again.',
        },
      ],
      structuredContent: {
        code: 'interpolation-unresolvable',
        variableKey: 'API_URL',
        jobKey: 'deploy',
      },
    });
  });

  it('names the runner labels and size figures of a refused start', async () => {
    const {triggers, provider} = createProvider();
    triggers.fireManualTrigger
      .mockRejectedValueOnce(
        createInterModuleKnownError(
          triggersInterModuleContract.methods.fireManualTrigger,
          'invalid-job-runner-labels',
          {labels: ['Big Box']},
        ),
      )
      .mockRejectedValueOnce(
        createInterModuleKnownError(
          triggersInterModuleContract.methods.fireManualTrigger,
          'workflow-execution-payload-too-large',
          {field: 'resolved_config', limitBytes: 1000, measuredBytes: 2500, overshootBytes: 1500},
        ),
      );
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });
    const call = () =>
      session.call({toolId: 'start_workflow_run', arguments: {workflow: 'child.yml'}});

    expect(await call()).toMatchObject({
      isError: true,
      content: [
        {
          text: 'Runner labels are not valid: `Big Box`. Use lowercase letters, digits, ".", "_" and "-".',
        },
      ],
    });
    expect(await call()).toMatchObject({
      isError: true,
      content: [{text: '`resolved_config` is too large: 2500 bytes, limit 1000 bytes.'}],
    });
  });

  it('tells the agent that the project source connection is unavailable', async () => {
    const {triggers, provider} = createProvider();
    triggers.fireManualTrigger.mockRejectedValue(
      createInterModuleKnownError(
        triggersInterModuleContract.methods.fireManualTrigger,
        'source-connection-unavailable',
        {
          projectId: crypto.randomUUID(),
          connectionId: crypto.randomUUID(),
          lifecycleStatus: 'disabled',
        },
      ),
    );
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    expect(
      await session.call({toolId: 'start_workflow_run', arguments: {workflow: 'child.yml'}}),
    ).toMatchObject({
      isError: true,
      content: [{text: expect.stringContaining('source connection is unavailable')}],
      structuredContent: {code: 'source-connection-unavailable', lifecycleStatus: 'disabled'},
    });
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

  it('reads logs directly by step id and resolves the requested attempt', async () => {
    const {logs, workflows, provider} = createProvider();
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    const result = await session.call({
      toolId: 'get_step_logs',
      arguments: {step_id: stepId, attempt: 2, tail_lines: 25},
    });

    expect(result).toMatchObject({
      structuredContent: {
        sections: [{step_id: stepId, attempt: 2, content: 'step output'}],
      },
    });
    expect(workflows.getWorkflowStepAttemptDetail).toHaveBeenCalledWith({
      workspaceId,
      stepId,
      attempt: 2,
    });
    expect(logs.readStepLogTail).toHaveBeenCalledWith({
      stepId,
      attempt: 2,
      tailLines: 25,
    });
  });

  it('reads the failed steps in a run and splits the byte budget', async () => {
    const {logs, workflows, provider} = createProvider();
    workflows.listFailedStepAttempts.mockResolvedValue({
      workflow_run_attempt: 3,
      items: [
        {
          workflow_run_id: parentRunId,
          workflow_run_attempt: 3,
          job_id: jobId,
          job_execution_id: jobExecutionId,
          step_id: stepId,
          step_attempt_id: stepAttemptId,
          step_attempt: 1,
        },
      ],
    });
    logs.readStepLogTail.mockResolvedValue({
      content: `${'x'.repeat(STEP_LOG_READ_CONTENT_MAX_BYTES)}\n`,
    });
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    const result = await session.call({
      toolId: 'get_step_logs',
      arguments: {run_id: parentRunId, failed_only: true},
    });
    const section = (
      result.structuredContent as {sections: [{content: string; content_total_bytes: number}]}
    ).sections[0];

    expect(section.content_total_bytes).toBeGreaterThan(STEP_LOG_READ_CONTENT_MAX_BYTES);
    expect(new TextEncoder().encode(section.content).byteLength).toBeLessThanOrEqual(
      STEP_LOG_READ_CONTENT_MAX_BYTES,
    );
    expect(result.structuredContent).toMatchObject({
      run_id: parentRunId,
      workflow_run_attempt: 3,
      sections: [{step_id: stepId, attempt: 1, content_truncated: true}],
    });
    const outputSchema = shipfoxAgentToolCatalog.find(
      (tool) => tool.id === 'get_step_logs',
    )?.outputSchema;
    expect(new Ajv({strict: false}).validate(outputSchema ?? {}, result.structuredContent)).toBe(
      true,
    );
  });

  it('pages run annotations with the producer cursor', async () => {
    const {annotations, provider} = createProvider();
    const nextCursor = {value: 7, id: annotationId};
    annotations.listAnnotationsForRunAttempt.mockResolvedValue({
      annotations: [
        {
          id: annotationId,
          origin_step_id: stepId,
          origin_step_attempt: 1,
          job_execution_id: jobExecutionId,
          sequence: 7,
          createdAt: '2026-01-01T00:00:00.000Z',
          body: 'failed because the deploy command exited',
        },
      ],
      nextCursor,
    });
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    const result = await session.call({
      toolId: 'get_run_annotations',
      arguments: {
        run_id: parentRunId,
        cursor: encodeNumberIdCursor({value: 3, id: stepId}),
        limit: 10,
      },
    });

    expect(annotations.listAnnotationsForRunAttempt).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: parentRunId,
      workflowRunAttempt: 1,
      cursor: {value: 3, id: stepId},
      limit: 10,
    });
    expect(result.structuredContent).toMatchObject({
      annotations: [{id: annotationId, body: 'failed because the deploy command exited'}],
      next_cursor: encodeNumberIdCursor(nextCursor),
    });
  });

  it('bounds an annotation page and resumes after the last retained item', async () => {
    const {annotations, provider} = createProvider();
    const page = Array.from({length: 100}, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
      origin_step_id: stepId,
      origin_step_attempt: 1,
      job_execution_id: jobExecutionId,
      sequence: index + 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      body: 'x'.repeat(8 * 1024),
    }));
    const producerLast = page.at(-1);
    if (producerLast === undefined) throw new Error('Expected a producer annotation');
    annotations.listAnnotationsForRunAttempt.mockResolvedValue({
      annotations: page,
      nextCursor: {value: 100, id: producerLast.id},
    });
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    const result = await session.call({
      toolId: 'get_run_annotations',
      arguments: {run_id: parentRunId, limit: 100},
    });

    const structured = result.structuredContent as {
      annotations: {id: string; sequence: number}[];
      next_cursor: string | null;
    };
    expect(new TextEncoder().encode(JSON.stringify(structured)).byteLength).toBeLessThanOrEqual(
      128 * 1024,
    );
    expect(structured.annotations.length).toBeGreaterThan(0);
    expect(structured.annotations.length).toBeLessThan(page.length);
    const last = structured.annotations.at(-1);
    if (last === undefined) throw new Error('Expected a retained annotation');
    expect(structured.next_cursor).toBe(encodeNumberIdCursor({value: last.sequence, id: last.id}));
  });

  it('masks a foreign workspace step as not found', async () => {
    const {workflows, provider} = createProvider();
    workflows.getWorkflowStepAttemptDetail.mockResolvedValue(null);
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller(),
    });

    const result = await session.call({
      toolId: 'get_step_logs',
      arguments: {step_id: stepId},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'not-found'}});
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
        status_reason: 'job_failed',
        status_reason_message: 'Job build failed.',
        outputs: null,
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

  it.each([
    {
      status: 'succeeded',
      status_reason: null,
      status_reason_message: null,
      outputs: {version: '1.2.3'},
    },
    {
      status: 'failed',
      status_reason: 'output_invalid',
      status_reason_message: 'Workflow output "version" could not be evaluated.',
      outputs: null,
    },
  ] as const)('returns the $status run attempt result', async (attemptResult) => {
    const {provider, workflows} = createProvider();
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
        created_at: '2026-01-01T00:00:00.000Z',
        started_at: '2026-01-01T00:00:00.000Z',
        finished_at: '2026-01-01T00:01:00.000Z',
        rerun_mode: null,
        ...attemptResult,
      },
      has_started_job_execution: true,
      jobs: {kind: 'complete', total: 0, items: []},
    });
    workflows.listWorkflowRunJobs.mockResolvedValue({
      workflow_run_attempt: 1,
      items: [],
      nextCursor: null,
      total: 0,
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

    expect(result.structuredContent).toMatchObject({
      run: {status: attemptResult.status},
      attempt: attemptResult,
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

describe('Shipfox tools for a conversation', () => {
  const otherProjectId = '00000000-0000-4000-8000-000000000030';

  function runOverview(runProjectId: string) {
    return {
      run: {project_id: runProjectId, number: 42},
      attempt: {attempt: 1},
      jobs: {kind: 'small', items: []},
      has_started_job_execution: false,
    };
  }

  function parentRun(parentProjectId: string) {
    return {id: parentRunId, number: 7, name: 'Secret parent', project_id: parentProjectId};
  }

  async function openConversationSession(provider: ReturnType<typeof createProvider>['provider']) {
    return await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: conversationCaller(),
    });
  }

  it('offers only project-scoped tools with no project_id parameter', () => {
    expect(shipfoxConversationToolCatalog.map((tool) => tool.id)).toEqual([
      'list_workflow_definitions',
      'list_workflow_runs',
      'get_workflow_run',
      'get_step_logs',
      'get_run_annotations',
    ]);
    expect(
      JSON.stringify(shipfoxConversationToolCatalog.map((tool) => tool.inputSchema)),
    ).not.toContain('project_id');
  });

  it('offers every input schema as one flat object', () => {
    for (const tool of shipfoxConversationToolCatalog) {
      expect(tool.inputSchema, tool.id).not.toHaveProperty('oneOf');
      expect(tool.inputSchema, tool.id).not.toHaveProperty('anyOf');
      expect(tool.inputSchema, tool.id).not.toHaveProperty('allOf');
      expect(tool.inputSchema, tool.id).toMatchObject({
        type: 'object',
        additionalProperties: false,
        properties: expect.any(Object),
      });
    }
  });

  it('offers both ways to read step logs in the flat schema', () => {
    const tool = shipfoxConversationToolCatalog.find(({id}) => id === 'get_step_logs');

    expect(Object.keys(tool?.inputSchema.properties as object).sort()).toEqual([
      'attempt',
      'failed_only',
      'run_id',
      'step_id',
      'tail_lines',
    ]);
    expect(
      shipfoxAgentToolCatalog.find(({id}) => id === 'get_step_logs')?.inputSchema,
    ).toHaveProperty('oneOf');
  });

  it.each([
    ['neither step_id nor run_id', {}],
    ['both step_id and run_id', {step_id: stepId, run_id: parentRunId, failed_only: true}],
    ['run_id without failed_only', {run_id: parentRunId}],
    ['attempt with run_id', {run_id: parentRunId, failed_only: true, attempt: 1}],
  ])('still rejects step logs with %s', async (_name, args) => {
    const {logs, provider} = createProvider();
    const session = await openConversationSession(provider);

    const result = await session.call({toolId: 'get_step_logs', arguments: args});

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'invalid-request'}});
    expect(logs.readStepLogTail).not.toHaveBeenCalled();
  });

  it('keeps every conversation input schema valid for the strict validator', () => {
    const ajv = new Ajv({strict: true, strictRequired: false});

    for (const tool of shipfoxConversationToolCatalog) {
      expect(() => ajv.compile(tool.inputSchema), tool.id).not.toThrow();
    }
  });

  it('leaves project_id in the lease catalog', () => {
    const leaseTools = shipfoxAgentToolCatalog.filter((tool) =>
      ['start_workflow_run', 'list_workflow_definitions', 'list_workflow_runs'].includes(tool.id),
    );

    for (const tool of leaseTools) {
      expect(tool.inputSchema, tool.id).toHaveProperty('properties.project_id');
    }
  });

  it.each([
    ['start_workflow_run', {workflow: 'child.yml'}],
    ['list_workflow_definitions', {}],
    ['list_workflow_runs', {}],
  ])('rejects an injected project_id on %s', async (toolId, args) => {
    const {definitions, projects, triggers, workflows, provider} = createProvider();
    const session = await openConversationSession(provider);

    const result = await session.call({
      toolId,
      arguments: {...args, project_id: otherProjectId},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'invalid-request'}});
    expect(result.content[0]?.text).toContain('project_id');
    expect(projects.requireProjectForWorkspace).not.toHaveBeenCalled();
    expect(definitions.getDefinitionByConfigPath).not.toHaveBeenCalled();
    expect(definitions.listDefinitionsByProject).not.toHaveBeenCalled();
    expect(workflows.listWorkflowRuns).not.toHaveBeenCalled();
    expect(triggers.fireManualTrigger).not.toHaveBeenCalled();
  });

  it('rejects a null project_id', async () => {
    const {workflows, provider} = createProvider();
    const session = await openConversationSession(provider);

    const result = await session.call({
      toolId: 'list_workflow_runs',
      arguments: {project_id: null},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'invalid-request'}});
    expect(workflows.listWorkflowRuns).not.toHaveBeenCalled();
  });

  it('lists runs in the caller project', async () => {
    const {workflows, provider} = createProvider();
    workflows.listWorkflowRuns.mockResolvedValue({
      runs: [],
      nextCursor: null,
      filteredTotalCount: 0,
    });
    const session = await openConversationSession(provider);

    const result = await session.call({toolId: 'list_workflow_runs', arguments: {}});

    expect(result.isError).toBeUndefined();
    expect(workflows.listWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({workspaceId, projectId}),
    );
  });

  it('lists definitions in the caller project', async () => {
    const {definitions, provider} = createProvider();
    definitions.listDefinitionsByProject.mockResolvedValue({definitions: [], nextCursor: null});
    const session = await openConversationSession(provider);

    const result = await session.call({toolId: 'list_workflow_definitions', arguments: {}});

    expect(result.isError).toBeUndefined();
    expect(definitions.listDefinitionsByProject).toHaveBeenCalledWith(
      expect.objectContaining({workspaceId, projectId}),
    );
  });

  it('refuses list_projects', async () => {
    const {projects, provider} = createProvider();
    const session = await openConversationSession(provider);

    const result = await session.call({toolId: 'list_projects', arguments: {}});

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'invalid-request'}});
    expect(projects.listProjectsByWorkspace).not.toHaveBeenCalled();
  });

  it('refuses to start a run', async () => {
    const {definitions, triggers, provider} = createProvider();
    const session = await openConversationSession(provider);

    const result = await session.call({
      toolId: 'start_workflow_run',
      arguments: {workflow: 'child.yml'},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'invalid-request'}});
    expect(definitions.getDefinitionByConfigPath).not.toHaveBeenCalled();
    expect(triggers.fireManualTrigger).not.toHaveBeenCalled();
  });

  it('reads a run in the caller project', async () => {
    const {workflows, provider} = createProvider();
    workflows.getWorkflowRunOverview.mockResolvedValue(runOverview(projectId));
    workflows.listWorkflowRunJobs.mockResolvedValue({items: [], nextCursor: null});
    const session = await openConversationSession(provider);

    const result = await session.call({
      toolId: 'get_workflow_run',
      arguments: {run_id: parentRunId},
    });

    expect(result).toMatchObject({structuredContent: {run: {project_id: projectId}}});
  });

  it('answers not found for a run in another project', async () => {
    const {workflows, provider} = createProvider();
    workflows.getWorkflowRunOverview.mockResolvedValue(runOverview(otherProjectId));
    const session = await openConversationSession(provider);

    const result = await session.call({
      toolId: 'get_workflow_run',
      arguments: {run_id: parentRunId},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'not-found'}});
    expect(workflows.listWorkflowRunJobs).not.toHaveBeenCalled();
  });

  it('hides a parent run from another project on a run read', async () => {
    const {workflows, provider} = createProvider();
    workflows.getWorkflowRunOverview.mockResolvedValue({
      ...runOverview(projectId),
      run: {...runOverview(projectId).run, parent_run: parentRun(otherProjectId)},
    });
    workflows.listWorkflowRunJobs.mockResolvedValue({items: [], nextCursor: null});
    const session = await openConversationSession(provider);

    const result = await session.call({
      toolId: 'get_workflow_run',
      arguments: {run_id: parentRunId},
    });

    expect(result).toMatchObject({structuredContent: {run: {parent_run: null}}});
    expect(result.content[0]?.text).not.toContain(otherProjectId);
    expect(result.content[0]?.text).not.toContain('Secret parent');
  });

  it('hides a parent run from another project on a run list', async () => {
    const {workflows, provider} = createProvider();
    workflows.listWorkflowRuns.mockResolvedValue({
      runs: [{id: childRunId, project_id: projectId, parent_run: parentRun(otherProjectId)}],
      nextCursor: null,
      filteredTotalCount: 1,
    });
    const session = await openConversationSession(provider);

    const result = await session.call({toolId: 'list_workflow_runs', arguments: {}});

    expect(result).toMatchObject({structuredContent: {runs: [{parent_run: null}]}});
    expect(result.content[0]?.text).not.toContain(otherProjectId);
    expect(result.content[0]?.text).not.toContain('Secret parent');
  });

  it('keeps a parent run from the caller project', async () => {
    const {workflows, provider} = createProvider();
    workflows.listWorkflowRuns.mockResolvedValue({
      runs: [{id: childRunId, project_id: projectId, parent_run: parentRun(projectId)}],
      nextCursor: null,
      filteredTotalCount: 1,
    });
    const session = await openConversationSession(provider);

    const result = await session.call({toolId: 'list_workflow_runs', arguments: {}});

    expect(result).toMatchObject({
      structuredContent: {runs: [{parent_run: parentRun(projectId)}]},
    });
  });

  it('reads step logs in the caller project', async () => {
    const {logs, workflows, provider} = createProvider();
    workflows.getWorkflowRunOverview.mockResolvedValue(runOverview(projectId));
    const session = await openConversationSession(provider);

    const result = await session.call({toolId: 'get_step_logs', arguments: {step_id: stepId}});

    expect(result.isError).toBeUndefined();
    expect(workflows.getWorkflowRunOverview).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: parentRunId,
    });
    expect(logs.readStepLogTail).toHaveBeenCalledOnce();
  });

  it('answers not found for a step in another project', async () => {
    const {logs, workflows, provider} = createProvider();
    workflows.getWorkflowRunOverview.mockResolvedValue(runOverview(otherProjectId));
    const session = await openConversationSession(provider);

    const result = await session.call({toolId: 'get_step_logs', arguments: {step_id: stepId}});

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'not-found'}});
    expect(logs.readStepLogTail).not.toHaveBeenCalled();
  });

  it('answers not found for a step with no run ancestry', async () => {
    const {logs, workflows, provider} = createProvider();
    workflows.getWorkflowStepAttemptDetail.mockResolvedValue({step_id: stepId, attempt: 1});
    const session = await openConversationSession(provider);

    const result = await session.call({toolId: 'get_step_logs', arguments: {step_id: stepId}});

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'not-found'}});
    expect(logs.readStepLogTail).not.toHaveBeenCalled();
  });

  it('answers not found for failed steps of a run in another project', async () => {
    const {workflows, provider} = createProvider();
    workflows.getWorkflowRunOverview.mockResolvedValue(runOverview(otherProjectId));
    const session = await openConversationSession(provider);

    const result = await session.call({
      toolId: 'get_step_logs',
      arguments: {run_id: parentRunId, failed_only: true},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'not-found'}});
    expect(workflows.listFailedStepAttempts).not.toHaveBeenCalled();
  });

  it('answers not found for annotations of a run in another project', async () => {
    const {annotations, workflows, provider} = createProvider();
    workflows.getWorkflowRunOverview.mockResolvedValue(runOverview(otherProjectId));
    const session = await openConversationSession(provider);

    const result = await session.call({
      toolId: 'get_run_annotations',
      arguments: {run_id: parentRunId},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'not-found'}});
    expect(annotations.listAnnotationsForRunAttempt).not.toHaveBeenCalled();
  });

  it('answers not found when the run does not exist', async () => {
    const {annotations, workflows, provider} = createProvider();
    workflows.getWorkflowRunOverview.mockResolvedValue(null);
    const session = await openConversationSession(provider);

    const result = await session.call({
      toolId: 'get_run_annotations',
      arguments: {run_id: parentRunId},
    });

    expect(result).toMatchObject({isError: true, structuredContent: {code: 'not-found'}});
    expect(annotations.listAnnotationsForRunAttempt).not.toHaveBeenCalled();
  });

  it('keeps a parent run from another project for a lease caller', async () => {
    const {workflows, provider} = createProvider();
    workflows.listWorkflowRuns.mockResolvedValue({
      runs: [{id: childRunId, project_id: projectId, parent_run: parentRun(otherProjectId)}],
      nextCursor: null,
      filteredTotalCount: 1,
    });
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller({callerKind: 'agent'}),
    });

    const result = await session.call({toolId: 'list_workflow_runs', arguments: {}});

    expect(result).toMatchObject({
      structuredContent: {runs: [{parent_run: parentRun(otherProjectId)}]},
    });
  });

  it('keeps reading across projects for a lease caller', async () => {
    const {annotations, logs, workflows, provider} = createProvider();
    workflows.getWorkflowRunOverview.mockResolvedValue(runOverview(otherProjectId));
    workflows.listWorkflowRunJobs.mockResolvedValue({items: [], nextCursor: null});
    const session = await provider.openSession({
      connection: {} as never,
      tools: provider.catalog(),
      scope: {},
      caller: caller({callerKind: 'agent'}),
    });

    const run = await session.call({
      toolId: 'get_workflow_run',
      arguments: {run_id: parentRunId},
    });
    const stepLogs = await session.call({toolId: 'get_step_logs', arguments: {step_id: stepId}});
    const runAnnotations = await session.call({
      toolId: 'get_run_annotations',
      arguments: {run_id: parentRunId},
    });

    expect(run.isError).toBeUndefined();
    expect(stepLogs.isError).toBeUndefined();
    expect(runAnnotations.isError).toBeUndefined();
    expect(logs.readStepLogTail).toHaveBeenCalledOnce();
    expect(annotations.listAnnotationsForRunAttempt).toHaveBeenCalledOnce();
  });
});
