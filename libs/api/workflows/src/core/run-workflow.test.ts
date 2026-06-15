import type {WorkflowDefinition} from '@shipfox/api-definitions';
import {workflowModel} from '#test/index.js';
import type {TriggerPayload} from './entities/workflow-run.js';
import {DefinitionNotFoundError, ProjectMismatchError} from './errors.js';
import {runWorkflow} from './run-workflow.js';

vi.mock('@shipfox/api-definitions', () => ({
  getDefinitionById: vi.fn(),
}));

import {getDefinitionById} from '@shipfox/api-definitions';

const mockGetDefinitionById = vi.mocked(getDefinitionById);

function buildDefinition(overrides?: Partial<WorkflowDefinition>): WorkflowDefinition {
  const model = workflowModel();
  const document = {
    name: model.name,
    jobs: {
      build: {steps: [{run: 'echo hello'}]},
    },
  };
  return {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    configPath: '.shipfox/workflows/test.yml',
    source: 'manual',
    sha: null,
    ref: null,
    name: 'Test Workflow',
    definition: document,
    sourceYaml: 'name: Test Workflow\n',
    document,
    model,
    contentHash: null,
    fetchedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
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
  });

  test('creates a run from a valid definition with the provided manual trigger payload', async () => {
    const definition = buildDefinition({projectId});
    mockGetDefinitionById.mockResolvedValue(definition);
    const triggerPayload = manualPayload();

    const run = await runWorkflow({
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
    expect(run.triggerSource).toBe('manual');
    expect(run.triggerEvent).toBe('fire');
    expect(run.triggerPayload).toEqual(triggerPayload);
  });

  test('persists an integration trigger payload intact', async () => {
    const definition = buildDefinition({projectId});
    mockGetDefinitionById.mockResolvedValue(definition);
    const triggerPayload: TriggerPayload = {
      source: 'github',
      event: 'push',
      deliveryId: crypto.randomUUID(),
      data: {ref: 'main', headCommitSha: 'abc', externalRepositoryId: 'github:1'},
    };

    const run = await runWorkflow({
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload,
    });

    expect(run.triggerSource).toBe('github');
    expect(run.triggerEvent).toBe('push');
    expect(run.triggerPayload).toEqual(triggerPayload);
  });

  test('throws DefinitionNotFoundError for unknown definition', async () => {
    mockGetDefinitionById.mockResolvedValue(undefined);

    const unknownId = crypto.randomUUID();

    await expect(
      runWorkflow({
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
    mockGetDefinitionById.mockResolvedValue(definition);

    await expect(
      runWorkflow({
        workspaceId,
        projectId,
        definitionId: definition.id,
        triggerPayload: manualPayload(),
      }),
    ).rejects.toThrow(ProjectMismatchError);
  });

  test('passes inputs through to the run', async () => {
    const definition = buildDefinition({projectId});
    mockGetDefinitionById.mockResolvedValue(definition);

    const run = await runWorkflow({
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload: manualPayload(),
      inputs: {env: 'staging'},
    });

    expect(run.inputs).toEqual({env: 'staging'});
  });
});
