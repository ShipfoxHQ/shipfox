import {getJobsByRunId} from '#db/index.js';
import {workflowRunFactory} from '#test/index.js';
import {onRunnerJobQueued} from './on-runner-job-queued.js';

describe('onRunnerJobQueued', () => {
  it('stamps queued_at on the job from the event payload', async () => {
    const run = await workflowRunFactory.create();
    const job = (await getJobsByRunId(run.id))[0];
    const queuedAt = new Date('2026-06-22T10:00:00.000Z');

    await onRunnerJobQueued({
      jobId: job?.id as string,
      runId: run.id,
      queuedAt: queuedAt.toISOString(),
    });

    const after = (await getJobsByRunId(run.id))[0];
    expect(after?.queuedAt?.getTime()).toBe(queuedAt.getTime());
  });

  it('is idempotent: a redelivered event keeps the first queued_at (coalesce)', async () => {
    const run = await workflowRunFactory.create();
    const job = (await getJobsByRunId(run.id))[0];
    const first = new Date('2026-06-22T10:00:00.000Z');
    const second = new Date('2026-06-22T11:00:00.000Z');

    await onRunnerJobQueued({
      jobId: job?.id as string,
      runId: run.id,
      queuedAt: first.toISOString(),
    });
    await onRunnerJobQueued({
      jobId: job?.id as string,
      runId: run.id,
      queuedAt: second.toISOString(),
    });

    const after = (await getJobsByRunId(run.id))[0];
    expect(after?.queuedAt?.getTime()).toBe(first.getTime());
  });
});
