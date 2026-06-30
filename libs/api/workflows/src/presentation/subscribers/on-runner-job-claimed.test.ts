import {getExecutionsByJobId, getJobsByRunId} from '#db/index.js';
import {workflowRunFactory} from '#test/index.js';
import {onRunnerJobClaimed} from './on-runner-job-claimed.js';

describe('onRunnerJobClaimed', () => {
  it('stamps started_at on the job from the claim event payload', async () => {
    const run = await workflowRunFactory.create();
    const job = (await getJobsByRunId(run.id))[0];
    const execution = (await getExecutionsByJobId(job?.id as string))[0];
    const claimedAt = new Date('2026-06-22T10:05:00.000Z');

    await onRunnerJobClaimed({
      jobId: job?.id as string,
      executionId: execution?.id,
      runId: run.id,
      claimedAt: claimedAt.toISOString(),
    });

    const after = (await getExecutionsByJobId(job?.id as string))[0];
    expect(after?.startedAt?.getTime()).toBe(claimedAt.getTime());
  });

  it('is idempotent: a redelivered event keeps the first started_at (coalesce)', async () => {
    const run = await workflowRunFactory.create();
    const job = (await getJobsByRunId(run.id))[0];
    const execution = (await getExecutionsByJobId(job?.id as string))[0];
    const first = new Date('2026-06-22T10:05:00.000Z');
    const second = new Date('2026-06-22T10:06:00.000Z');

    await onRunnerJobClaimed({
      jobId: job?.id as string,
      executionId: execution?.id,
      runId: run.id,
      claimedAt: first.toISOString(),
    });
    await onRunnerJobClaimed({
      jobId: job?.id as string,
      executionId: execution?.id,
      runId: run.id,
      claimedAt: second.toISOString(),
    });

    const after = (await getExecutionsByJobId(job?.id as string))[0];
    expect(after?.startedAt?.getTime()).toBe(first.getTime());
  });
});
