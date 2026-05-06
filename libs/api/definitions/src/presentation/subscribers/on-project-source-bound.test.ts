import type {ProjectSourceBoundEvent} from '@shipfox/api-projects-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {onProjectSourceBound} from './on-project-source-bound.js';

const startMock = vi.fn();
const errorLogMock = vi.fn();

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
    error: errorLogMock,
  }),
}));

function buildPayload(): ProjectSourceBoundEvent {
  return {
    actorId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    sourceConnectionId: crypto.randomUUID(),
    provider: 'debug',
    externalRepositoryId: 'debug:platform',
  };
}

function buildEvent(payload: ProjectSourceBoundEvent): DomainEvent {
  return {
    id: crypto.randomUUID(),
    type: 'projects.project.source_bound',
    createdAt: new Date(),
    payload,
  };
}

describe('onProjectSourceBound', () => {
  beforeEach(() => {
    startMock.mockReset();
    errorLogMock.mockReset();
    startMock.mockResolvedValue({});
  });

  it('starts a definition sync workflow keyed on project + connection + repository id', async () => {
    const payload = buildPayload();

    await onProjectSourceBound(buildEvent(payload));

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith('definitionSyncWorkflow', {
      taskQueue: 'definitions-sync',
      workflowId: `definition-sync:${payload.projectId}:${payload.sourceConnectionId}:${payload.externalRepositoryId}`,
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
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

  it('logs and rethrows when the temporal client fails to start', async () => {
    const failure = new Error('temporal unavailable');
    startMock.mockRejectedValueOnce(failure);
    const payload = buildPayload();

    const result = onProjectSourceBound(buildEvent(payload));

    await expect(result).rejects.toBe(failure);
    expect(errorLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        err: failure,
        projectId: payload.projectId,
        sourceConnectionId: payload.sourceConnectionId,
      }),
      'Failed to start definition sync workflow',
    );
  });
});
