import type {WorkflowsJobTerminatedEventDto} from '@shipfox/api-workflows-dto';
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

function buildPayload(jobId: string): WorkflowsJobTerminatedEventDto {
  return {
    jobId,
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    status: 'failed',
    statusReason: null,
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

  it('arms a cause-free close workflow for an ordinary terminal job', async () => {
    const jobId = crypto.randomUUID();

    await onJobTerminated(buildPayload(jobId));

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith('closeAbandonedStreams', {
      taskQueue: LOGS_LIFECYCLE_TASK_QUEUE,
      workflowId: `logs-close:${jobId}`,
      args: [
        {
          jobId,
          graceSeconds: config.LOG_STREAM_CLOSE_GRACE_SECONDS,
          terminalCause: null,
        },
      ],
    });
  });

  it.each([
    {statusReason: 'timed_out' as const, terminalCause: 'timed_out'},
    {statusReason: 'run_cancelled' as const, terminalCause: 'run_cancelled'},
    {statusReason: 'user_cancelled' as const, terminalCause: 'run_cancelled'},
    {statusReason: 'runner_lost' as const, terminalCause: 'runner_lost'},
  ])('passes $terminalCause into the grace sweep', async ({statusReason, terminalCause}) => {
    const payload = {...buildPayload(crypto.randomUUID()), statusReason};

    await onJobTerminated(payload);

    expect(startMock).toHaveBeenCalledWith(
      'closeAbandonedStreams',
      expect.objectContaining({args: [expect.objectContaining({terminalCause})]}),
    );
  });

  it('swallows a redelivered event when the workflow is already started', async () => {
    startMock.mockRejectedValue(alreadyStartedError());

    await expect(onJobTerminated(buildPayload(crypto.randomUUID()))).resolves.toBeUndefined();
  });

  it('re-throws an unexpected start failure so the outbox retries delivery', async () => {
    startMock.mockRejectedValue(new Error('temporal unreachable'));

    await expect(onJobTerminated(buildPayload(crypto.randomUUID()))).rejects.toThrow(
      'temporal unreachable',
    );
  });
});
