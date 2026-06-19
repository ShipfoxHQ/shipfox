import type {WorkflowsJobTerminatedEvent} from '@shipfox/api-workflows-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {config} from '#config.js';
import {LOGS_LIFECYCLE_TASK_QUEUE} from '#temporal/constants.js';
import {onJobTerminated} from './on-job-terminated.js';

const startMock = vi.fn();

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({
    workflow: {
      start: startMock,
    },
  }),
}));

function buildEvent(jobId: string): DomainEvent {
  const payload: WorkflowsJobTerminatedEvent = {
    jobId,
    runId: crypto.randomUUID(),
    status: 'failed',
  };
  return {
    id: crypto.randomUUID(),
    type: 'workflows.job.terminated',
    createdAt: new Date(),
    payload,
  };
}

function alreadyStartedError(): Error {
  const error = new Error('Workflow execution already started');
  error.name = 'WorkflowExecutionAlreadyStartedError';
  return error;
}

describe('onJobTerminated', () => {
  beforeEach(() => {
    startMock.mockReset();
    startMock.mockResolvedValue({});
  });

  it('arms the close-abandoned-streams workflow keyed on the job id', async () => {
    const jobId = crypto.randomUUID();

    await onJobTerminated(buildEvent(jobId));

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith('closeAbandonedStreams', {
      taskQueue: LOGS_LIFECYCLE_TASK_QUEUE,
      workflowId: `logs-close:${jobId}`,
      args: [{jobId, graceSeconds: config.LOG_STREAM_CLOSE_GRACE_SECONDS}],
    });
  });

  it('swallows a redelivered event when the workflow is already started', async () => {
    startMock.mockRejectedValue(alreadyStartedError());

    await expect(onJobTerminated(buildEvent(crypto.randomUUID()))).resolves.toBeUndefined();
  });

  it('re-throws an unexpected start failure so the outbox retries delivery', async () => {
    startMock.mockRejectedValue(new Error('temporal unreachable'));

    await expect(onJobTerminated(buildEvent(crypto.randomUUID()))).rejects.toThrow(
      'temporal unreachable',
    );
  });
});
