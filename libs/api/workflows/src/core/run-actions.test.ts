import {createRerunWorkflowRun, updateWorkflowRunStatus} from '#db/workflow-runs.js';
import {workflowRunFactory} from '#test/index.js';
import {WorkflowRunAttemptMismatchError} from './errors.js';
import {rerunWorkflowRun} from './run-actions.js';

describe('workflow run actions', () => {
  test.each([
    ['denied', () => vi.fn().mockResolvedValue({status: 'suspended' as const})],
    ['unavailable', () => vi.fn().mockRejectedValue(new Error('workspace service unavailable'))],
  ])('answers attempt mismatch before %s admission', async (_case, createOperatingStateMock) => {
    const source = await workflowRunFactory.create();
    await updateWorkflowRunStatus({
      workflowRunId: source.id,
      status: 'failed',
      expectedVersion: source.version,
    });
    const current = await createRerunWorkflowRun({
      workflowRunId: source.id,
      mode: 'all',
      actorUserId: crypto.randomUUID(),
    });
    const getWorkspaceOperatingState = createOperatingStateMock();

    const action = rerunWorkflowRun({
      workspaceId: source.workspaceId,
      workflowRunId: source.id,
      expectedAttempt: source.currentAttempt,
      mode: 'all',
      actorUserId: crypto.randomUUID(),
      workspaces: {getWorkspaceOperatingState},
    });

    await expect(action).rejects.toMatchObject({
      name: WorkflowRunAttemptMismatchError.name,
      currentAttempt: current.currentAttempt,
    });
    expect(getWorkspaceOperatingState).not.toHaveBeenCalled();
  });
});
