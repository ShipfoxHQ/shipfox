import type {ProjectSourceBoundEvent} from '@shipfox/api-projects-dto';
import {onProjectSourceBound} from './on-project-source-bound.js';

const startMock = vi.fn();

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({
    workflow: {
      start: startMock,
    },
  }),
}));

function buildPayload(): ProjectSourceBoundEvent {
  return {
    actorId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    sourceConnectionId: crypto.randomUUID(),
    provider: 'gitea',
    externalRepositoryId: 'gitea:gitea-owner/platform',
  };
}

describe('onProjectSourceBound', () => {
  beforeEach(() => {
    startMock.mockReset();
    startMock.mockResolvedValue({});
  });

  it('starts a definition sync workflow keyed on project + bind', async () => {
    const payload = buildPayload();

    const result = onProjectSourceBound(payload);
    await result;

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith('definitionSyncWorkflow', {
      taskQueue: 'definitions-sync',
      workflowId: `definition-sync:${payload.projectId}:bind`,
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      args: [
        {
          projectId: payload.projectId,
          workspaceId: payload.workspaceId,
          sourceConnectionId: payload.sourceConnectionId,
          sourceExternalRepositoryId: payload.externalRepositoryId,
          sourceRef: undefined,
          sourceCommitSha: undefined,
        },
      ],
    });
  });

  it('rethrows when the temporal client fails to start', async () => {
    const failure = new Error('temporal unavailable');
    startMock.mockRejectedValueOnce(failure);
    const payload = buildPayload();

    const result = onProjectSourceBound(payload);

    await expect(result).rejects.toBe(failure);
  });
});
