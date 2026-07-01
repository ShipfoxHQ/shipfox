import {getJobExecutionsByJobId, getJobsByWorkflowRunId} from '#db/index.js';
import {workflowRunFactory} from '#test/index.js';
import {onRunnerJobClaimed} from './on-runner-job-claimed.js';

describe('onRunnerJobClaimed', () => {
  it('stamps started_at on the job execution from the claim event payload', async () => {
    const run = await workflowRunFactory.create();
    const job = (await getJobsByWorkflowRunId(run.id))[0];
    expect(job).toBeDefined();
    if (!job) return;
    const jobExecution = (await getJobExecutionsByJobId(job.id))[0];
    expect(jobExecution).toBeDefined();
    if (!jobExecution) return;
    const claimedAt = new Date('2026-06-22T10:05:00.000Z');

    await onRunnerJobClaimed({
      jobId: job.id,
      jobExecutionId: jobExecution.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      claimedAt: claimedAt.toISOString(),
    });

    const after = (await getJobExecutionsByJobId(job.id))[0];
    expect(after?.startedAt?.getTime()).toBe(claimedAt.getTime());
  });

  it('is idempotent: a redelivered event keeps the first started_at (coalesce)', async () => {
    const run = await workflowRunFactory.create();
    const job = (await getJobsByWorkflowRunId(run.id))[0];
    expect(job).toBeDefined();
    if (!job) return;
    const jobExecution = (await getJobExecutionsByJobId(job.id))[0];
    expect(jobExecution).toBeDefined();
    if (!jobExecution) return;
    const first = new Date('2026-06-22T10:05:00.000Z');
    const second = new Date('2026-06-22T10:06:00.000Z');

    await onRunnerJobClaimed({
      jobId: job.id,
      jobExecutionId: jobExecution.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      claimedAt: first.toISOString(),
    });
    await onRunnerJobClaimed({
      jobId: job.id,
      jobExecutionId: jobExecution.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      claimedAt: second.toISOString(),
    });

    const after = (await getJobExecutionsByJobId(job.id))[0];
    expect(after?.startedAt?.getTime()).toBe(first.getTime());
  });
});
