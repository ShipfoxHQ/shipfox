import type {WorkflowsWorkflowRunCreatedEvent} from '@shipfox/api-workflows-dto';
import {onWorkflowRunCreated} from './on-workflow-run-created.js';

const startMock = vi.fn();

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({workflow: {start: startMock}}),
}));

function buildPayload(
  overrides: Partial<WorkflowsWorkflowRunCreatedEvent> = {},
): WorkflowsWorkflowRunCreatedEvent {
  return {
    runId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    ...overrides,
  };
}

describe('onWorkflowRunCreated', () => {
  beforeEach(() => {
    startMock.mockReset();
    startMock.mockResolvedValue({});
  });

  it('starts the run orchestration keyed on the run id', async () => {
    const payload = buildPayload();

    await onWorkflowRunCreated(payload);

    expect(startMock).toHaveBeenCalledWith('runOrchestration', {
      taskQueue: 'workflows-orchestrator',
      workflowId: `run:${payload.runId}`,
      args: [{runId: payload.runId, workspaceId: payload.workspaceId}],
    });
  });

  it('swallows an already-started orchestration (outbox is at-least-once)', async () => {
    const alreadyStarted = new Error('already started');
    alreadyStarted.name = 'WorkflowExecutionAlreadyStartedError';
    startMock.mockRejectedValueOnce(alreadyStarted);

    const result = onWorkflowRunCreated(buildPayload());

    await expect(result).resolves.toBeUndefined();
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows any other start failure', async () => {
    const failure = new Error('temporal unavailable');
    startMock.mockRejectedValueOnce(failure);

    const result = onWorkflowRunCreated(buildPayload());

    await expect(result).rejects.toBe(failure);
  });
});
