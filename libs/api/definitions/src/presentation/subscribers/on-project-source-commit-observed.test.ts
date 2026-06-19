import type {ProjectSourceCommitObservedEvent} from '@shipfox/api-projects-dto';
import {onProjectSourceCommitObserved} from './on-project-source-commit-observed.js';

const startMock = vi.fn();

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({
    workflow: {
      start: startMock,
    },
  }),
}));

function buildPayload(): ProjectSourceCommitObservedEvent {
  return {
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    sourceConnectionId: crypto.randomUUID(),
    provider: 'github',
    externalRepositoryId: 'github:42',
    ref: 'main',
    headCommitSha: 'abc123',
  };
}

describe('onProjectSourceCommitObserved', () => {
  beforeEach(() => {
    startMock.mockReset();
    startMock.mockResolvedValue({});
  });

  it('starts a definition sync workflow keyed on project + source commit sha', async () => {
    const payload = buildPayload();

    const result = onProjectSourceCommitObserved(payload);
    await result;

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith('definitionSyncWorkflow', {
      taskQueue: 'definitions-sync',
      workflowId: `definition-sync:${payload.projectId}:${payload.headCommitSha}`,
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      args: [
        {
          projectId: payload.projectId,
          workspaceId: payload.workspaceId,
          sourceConnectionId: payload.sourceConnectionId,
          sourceExternalRepositoryId: payload.externalRepositoryId,
          sourceRef: payload.ref,
          sourceCommitSha: payload.headCommitSha,
        },
      ],
    });
  });
});
