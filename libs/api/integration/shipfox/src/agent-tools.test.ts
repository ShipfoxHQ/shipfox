import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
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
  };
  const triggers = {
    fireManualTrigger: vi.fn().mockResolvedValue({
      id: childRunId,
      name: 'Deploy',
      deduplicated: false,
    }),
  };
  const workflows = {
    getWorkflowRunOverview: vi.fn().mockResolvedValue({
      run: {number: 42},
    }),
  };
  const provider = createShipfoxAgentToolsProvider({definitions, triggers, workflows});
  return {definitions, triggers, workflows, provider};
}

describe('Shipfox agent tools', () => {
  it('has exactly the start_workflow_run catalog entry', () => {
    expect(shipfoxAgentToolCatalog.map((tool) => tool.id)).toEqual(['start_workflow_run']);
    expect('methods' in (shipfoxAgentToolCatalog[0] ?? {})).toBe(false);
    expect(shipfoxAgentToolCatalog[0]?.outputSchema).toMatchObject({
      additionalProperties: false,
      required: ['run_id', 'run_number', 'name', 'project_id', 'deduplicated'],
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
      idempotencyKey: 'start-child:2',
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
      caller: caller({projectId: '00000000-0000-4000-8000-000000000009'}),
    });
    const explicitProject = '00000000-0000-4000-8000-000000000009';

    await session.call({
      toolId: 'start_workflow_run',
      arguments: {workflow: 'child.yml', project_id: explicitProject, inputs: {version: '1.2.3'}},
    });

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
});
