import type {WorkflowsRunAttemptCreatedEvent} from '@shipfox/api-workflows-dto';
import {onRunAttemptCreated} from './on-run-attempt-created.js';

const startMock = vi.fn();

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({workflow: {start: startMock}}),
}));

function buildPayload(
  overrides: Partial<WorkflowsRunAttemptCreatedEvent> = {},
): WorkflowsRunAttemptCreatedEvent {
  return {
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    attempt: 1,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    ...overrides,
  };
}

describe('onRunAttemptCreated', () => {
  beforeEach(() => {
    startMock.mockReset();
    startMock.mockResolvedValue({});
  });

  it('starts the run orchestration keyed on the attempt id', async () => {
    const payload = buildPayload();

    await onRunAttemptCreated(payload);

    expect(startMock).toHaveBeenCalledWith('runOrchestration', {
      taskQueue: 'workflows-orchestrator',
      workflowId: `run-attempt:${payload.workflowRunAttemptId}`,
      args: [
        {
          workflowRunId: payload.workflowRunId,
          runAttemptId: payload.workflowRunAttemptId,
          workspaceId: payload.workspaceId,
        },
      ],
    });
  });

  it('swallows an already-started orchestration (outbox is at-least-once)', async () => {
    const alreadyStarted = new Error('already started');
    alreadyStarted.name = 'WorkflowExecutionAlreadyStartedError';
    startMock.mockRejectedValueOnce(alreadyStarted);

    const result = onRunAttemptCreated(buildPayload());

    await expect(result).resolves.toBeUndefined();
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows any other start failure', async () => {
    const failure = new Error('temporal unavailable');
    startMock.mockRejectedValueOnce(failure);

    const result = onRunAttemptCreated(buildPayload());

    await expect(result).rejects.toBe(failure);
  });
});
