import {createWorkflowModelSnapshot, type WorkflowModel} from '@shipfox/api-definitions-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {workflowModel} from '#test/index.js';
import type {TriggerPayload} from './entities/workflow-run.js';
import {DefinitionNotFoundError, ProjectMismatchError} from './errors.js';
import {runWorkflow} from './run-workflow.js';

const mockCreateWorkspaceAgentDefaultsResolver = vi.hoisted(() => vi.fn());
const mockWorkspaceAgentDefaultsResolver = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    harness: 'pi',
    provider: 'openai',
    model: 'gpt-5.5-pro',
    thinking: 'medium',
  }),
);

vi.mock('@shipfox/api-agent/core/resolve-agent-config', () => {
  return {
    catalogDefaultAgentResolver: vi.fn().mockReturnValue({
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'xhigh',
    }),
  };
});

vi.mock('@shipfox/api-agent/core/workspace-agent-defaults-resolver', () => {
  return {
    createWorkspaceAgentDefaultsResolver: mockCreateWorkspaceAgentDefaultsResolver,
  };
});

function buildDefinition(
  overrides?: Partial<{
    id: string;
    projectId: string;
    name: string;
    model: WorkflowModel;
    sourceSnapshot: {content: string; format: 'yaml'} | null;
  }>,
) {
  const model = workflowModel();
  return {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    name: 'Test Workflow',
    model,
    sourceSnapshot: null,
    ...overrides,
  };
}

function definitionsClient(
  definition: ReturnType<typeof buildDefinition> | undefined,
): DefinitionsInterModuleClient {
  return {
    getDefinitionForWorkflowRun: vi.fn().mockResolvedValue({
      definition:
        definition === undefined
          ? null
          : {
              id: definition.id,
              projectId: definition.projectId,
              name: definition.name,
              model: createWorkflowModelSnapshot(definition.model),
              sourceSnapshot: definition.sourceSnapshot,
            },
    }),
  };
}

function manualPayload(): TriggerPayload {
  return {
    source: 'manual',
    event: 'fire',
    subscriptionId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
  };
}

describe('runWorkflow', () => {
  let workspaceId: string;
  let projectId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    mockCreateWorkspaceAgentDefaultsResolver.mockClear();
    mockCreateWorkspaceAgentDefaultsResolver.mockResolvedValue(mockWorkspaceAgentDefaultsResolver);
    mockWorkspaceAgentDefaultsResolver.mockClear();
  });

  test('creates a run from a valid definition with the provided manual trigger payload', async () => {
    const definition = buildDefinition({projectId});
    const triggerPayload = manualPayload();

    const run = await runWorkflow(definitionsClient(definition), {
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload,
    });

    expect(run.id).toBeDefined();
    expect(run.projectId).toBe(projectId);
    expect(run.definitionId).toBe(definition.id);
    expect(run.name).toBe(definition.name);
    expect(run.status).toBe('pending');
    expect(run.triggerProvider).toBeNull();
    expect(run.triggerSource).toBe('manual');
    expect(run.triggerEvent).toBe('fire');
    expect(run.triggerPayload).toEqual(triggerPayload);
    expect(mockCreateWorkspaceAgentDefaultsResolver).not.toHaveBeenCalled();
  });

  test('builds the workspace agent resolver only when the definition has an agent step', async () => {
    const model = workflowModel({
      jobs: {
        fix: {steps: [{prompt: 'Fix the failing tests.'}]},
      },
    });
    const definition = buildDefinition({projectId, model});

    const run = await runWorkflow(definitionsClient(definition), {
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload: manualPayload(),
    });

    expect(run.id).toBeDefined();
    expect(mockCreateWorkspaceAgentDefaultsResolver).toHaveBeenCalledWith(workspaceId);
    expect(mockWorkspaceAgentDefaultsResolver).toHaveBeenCalledWith({
      harness: undefined,
      provider: undefined,
      model: undefined,
      thinking: undefined,
    });
  });

  test('persists an integration trigger payload intact', async () => {
    const definition = buildDefinition({projectId});
    const triggerPayload: TriggerPayload = {
      provider: 'github',
      source: 'github_acme',
      event: 'push',
      deliveryId: crypto.randomUUID(),
      data: {ref: 'main', headCommitSha: 'abc', externalRepositoryId: 'github:1'},
    };

    const run = await runWorkflow(definitionsClient(definition), {
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload,
    });

    expect(run.triggerProvider).toBe('github');
    expect(run.triggerSource).toBe('github_acme');
    expect(run.triggerEvent).toBe('push');
    expect(run.triggerPayload).toEqual(triggerPayload);
  });

  test('creates the run with the definition source snapshot', async () => {
    const sourceSnapshot = {content: 'name: Test Workflow\njobs: {}\n', format: 'yaml'} as const;
    const definition = buildDefinition({projectId, sourceSnapshot});

    const run = await runWorkflow(definitionsClient(definition), {
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload: manualPayload(),
    });

    expect(run.sourceSnapshot).toEqual(sourceSnapshot);
  });

  test('throws DefinitionNotFoundError for unknown definition', async () => {
    const unknownId = crypto.randomUUID();

    await expect(
      runWorkflow(definitionsClient(undefined), {
        workspaceId,
        projectId,
        definitionId: unknownId,
        triggerPayload: manualPayload(),
      }),
    ).rejects.toThrow(DefinitionNotFoundError);
  });

  test('throws ProjectMismatchError when definition.projectId does not match', async () => {
    const otherProjectId = crypto.randomUUID();
    const definition = buildDefinition({projectId: otherProjectId});
    await expect(
      runWorkflow(definitionsClient(definition), {
        workspaceId,
        projectId,
        definitionId: definition.id,
        triggerPayload: manualPayload(),
      }),
    ).rejects.toThrow(ProjectMismatchError);
  });

  test('passes inputs through to the run', async () => {
    const definition = buildDefinition({projectId});
    const run = await runWorkflow(definitionsClient(definition), {
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload: manualPayload(),
      inputs: {env: 'staging'},
    });

    expect(run.inputs).toEqual({env: 'staging'});
  });
});
