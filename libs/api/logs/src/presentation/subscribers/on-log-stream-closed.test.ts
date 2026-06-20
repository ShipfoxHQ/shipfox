import type {LogStreamClosedEvent} from '@shipfox/api-logs-dto';
import {LOGS_COMPACTION_TASK_QUEUE} from '#temporal/constants.js';
import {onLogStreamClosed} from './on-log-stream-closed.js';

const startMock = vi.hoisted(() => vi.fn());

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({
    workflow: {
      start: startMock,
    },
  }),
}));

function buildPayload(streamId: string): LogStreamClosedEvent {
  return {
    workspaceId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    streamId,
  };
}

function alreadyStartedError(): Error {
  const error = new Error('Workflow execution already started');
  error.name = 'WorkflowExecutionAlreadyStartedError';
  return error;
}

describe('onLogStreamClosed', () => {
  beforeEach(() => {
    startMock.mockReset();
    startMock.mockResolvedValue({});
  });

  it('starts the compaction workflow keyed on the stream id', async () => {
    const streamId = crypto.randomUUID();

    await onLogStreamClosed(buildPayload(streamId));

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith('compactStream', {
      taskQueue: LOGS_COMPACTION_TASK_QUEUE,
      workflowId: `logs-compact:${streamId}`,
      args: [{streamId}],
    });
  });

  it('swallows a redelivered event when the workflow is already started', async () => {
    startMock.mockRejectedValue(alreadyStartedError());

    await expect(onLogStreamClosed(buildPayload(crypto.randomUUID()))).resolves.toBeUndefined();
  });

  it('re-throws an unexpected start failure so the outbox retries delivery', async () => {
    startMock.mockRejectedValue(new Error('temporal unreachable'));

    await expect(onLogStreamClosed(buildPayload(crypto.randomUUID()))).rejects.toThrow(
      'temporal unreachable',
    );
  });
});
