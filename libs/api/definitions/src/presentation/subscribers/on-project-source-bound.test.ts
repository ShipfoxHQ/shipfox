import type {ProjectSourceBoundEvent} from '@shipfox/api-projects-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {onProjectSourceBound} from './on-project-source-bound.js';

const startMock = vi.fn();

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({
    workflow: {
      start: startMock,
    },
  }),
}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({
    info: vi.fn(),
  }),
}));

describe('onProjectSourceBound', () => {
  beforeEach(() => {
    startMock.mockResolvedValue({});
  });

  it('starts a definition sync workflow for the source-bound project', async () => {
    const payload: ProjectSourceBoundEvent = {
      actorId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      sourceConnectionId: crypto.randomUUID(),
      provider: 'debug',
      externalRepositoryId: 'platform',
    };
    const event: DomainEvent = {
      id: crypto.randomUUID(),
      type: 'projects.project.source_bound',
      createdAt: new Date(),
      payload,
    };

    await onProjectSourceBound(event);

    expect(startMock).toHaveBeenCalledWith('definitionSyncWorkflow', {
      taskQueue: 'definitions-sync',
      workflowId: `definition-sync:${payload.projectId}:${payload.externalRepositoryId}`,
      args: [
        {
          projectId: payload.projectId,
          workspaceId: payload.workspaceId,
          sourceConnectionId: payload.sourceConnectionId,
          sourceExternalRepositoryId: payload.externalRepositoryId,
        },
      ],
    });
  });

  it('treats an already-started workflow as idempotent success', async () => {
    const error = new Error('already started');
    error.name = 'WorkflowExecutionAlreadyStartedError';
    startMock.mockRejectedValue(error);
    const payload: ProjectSourceBoundEvent = {
      actorId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      sourceConnectionId: crypto.randomUUID(),
      provider: 'debug',
      externalRepositoryId: 'platform',
    };
    const event: DomainEvent = {
      id: crypto.randomUUID(),
      type: 'projects.project.source_bound',
      createdAt: new Date(),
      payload,
    };

    const result = onProjectSourceBound(event);

    await expect(result).resolves.toBeUndefined();
  });
});
