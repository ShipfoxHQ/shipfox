import type {WorkflowsJobTimedOutEvent} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {claimPendingJobExecution} from '#db/job-executions.js';
import {runningJobExecutions} from '#db/schema/running-job-executions.js';
import {pendingJobFactory, runnerSessionFactory} from '#test/index.js';
import {onWorkflowsJobTimedOut} from './on-workflows-job-timed-out.js';

function buildPayload(jobId: string, runId: string): WorkflowsJobTimedOutEvent {
  return {jobId, executionId: jobId, runId};
}

describe('onWorkflowsJobTimedOut', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('sets cancellation_requested_at on the matching running_jobs row', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      sessionLabels: ['linux', 'x64'],
      maxClaims: null,
    });
    expect(claimed).not.toBeNull();

    await onWorkflowsJobTimedOut(buildPayload(claimed?.jobId as string, claimed?.runId as string));

    const rows = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    expect(rows[0]?.cancellationRequestedAt).not.toBeNull();
  });

  it('idempotent under double delivery: second call preserves the first timestamp', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      sessionLabels: ['linux', 'x64'],
      maxClaims: null,
    });

    await onWorkflowsJobTimedOut(buildPayload(claimed?.jobId as string, claimed?.runId as string));
    const after1 = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    const firstTs = after1[0]?.cancellationRequestedAt;

    await new Promise((r) => setTimeout(r, 10));
    await onWorkflowsJobTimedOut(buildPayload(claimed?.jobId as string, claimed?.runId as string));

    const after2 = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    expect(after2[0]?.cancellationRequestedAt?.getTime()).toBe(firstTs?.getTime());
  });

  it('no-op when the running_jobs row is gone (already finalized)', async () => {
    // Row was finalized by another path before the event reached us.
    await expect(
      onWorkflowsJobTimedOut(buildPayload(crypto.randomUUID(), crypto.randomUUID())),
    ).resolves.toBeUndefined();
  });
});
