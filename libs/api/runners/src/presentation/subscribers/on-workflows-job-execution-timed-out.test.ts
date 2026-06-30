import type {WorkflowsJobExecutionTimedOutEvent} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {claimPendingJobExecution} from '#db/job-executions.js';
import {runningJobExecutions} from '#db/schema/running-job-executions.js';
import {pendingJobFactory, runnerSessionFactory} from '#test/index.js';
import {onWorkflowsJobExecutionTimedOut} from './on-workflows-job-execution-timed-out.js';

function buildPayload(
  jobId: string,
  executionId: string,
  runId: string,
): WorkflowsJobExecutionTimedOutEvent {
  return {jobId, executionId, runId};
}

describe('onWorkflowsJobExecutionTimedOut', () => {
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

    await onWorkflowsJobExecutionTimedOut(
      buildPayload(
        claimed?.jobId as string,
        claimed?.executionId as string,
        claimed?.runId as string,
      ),
    );

    const rows = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    expect(rows[0]?.cancellationRequestedAt).not.toBeNull();
  });

  it('does not cancel another running execution for the same job', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      sessionLabels: ['linux', 'x64'],
      maxClaims: null,
    });
    expect(claimed).not.toBeNull();
    const siblingExecutionId = crypto.randomUUID();
    const siblingRunnerSession = await runnerSessionFactory.create({workspaceId});
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        jobId: claimed?.jobId as string,
        executionId: siblingExecutionId,
        runId: claimed?.runId as string,
        projectId: claimed?.projectId as string,
        runnerSessionId: siblingRunnerSession.id,
        requiredLabels: ['linux'],
        runnerLabels: ['linux', 'x64'],
      });

    await onWorkflowsJobExecutionTimedOut(
      buildPayload(
        claimed?.jobId as string,
        claimed?.executionId as string,
        claimed?.runId as string,
      ),
    );

    const rows = await db()
      .select({
        executionId: runningJobExecutions.executionId,
        cancellationRequestedAt: runningJobExecutions.cancellationRequestedAt,
      })
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    const byExecutionId = new Map(
      rows.map((row) => [row.executionId, row.cancellationRequestedAt]),
    );
    expect(byExecutionId.get(claimed?.executionId as string)).not.toBeNull();
    expect(byExecutionId.get(siblingExecutionId)).toBeNull();
  });

  it('idempotent under double delivery: second call preserves the first timestamp', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      sessionLabels: ['linux', 'x64'],
      maxClaims: null,
    });

    await onWorkflowsJobExecutionTimedOut(
      buildPayload(
        claimed?.jobId as string,
        claimed?.executionId as string,
        claimed?.runId as string,
      ),
    );
    const after1 = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    const firstTs = after1[0]?.cancellationRequestedAt;

    await new Promise((r) => setTimeout(r, 10));
    await onWorkflowsJobExecutionTimedOut(
      buildPayload(
        claimed?.jobId as string,
        claimed?.executionId as string,
        claimed?.runId as string,
      ),
    );

    const after2 = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    expect(after2[0]?.cancellationRequestedAt?.getTime()).toBe(firstTs?.getTime());
  });

  it('no-op when the running_jobs row is gone (already finalized)', async () => {
    await expect(
      onWorkflowsJobExecutionTimedOut(
        buildPayload(crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()),
      ),
    ).resolves.toBeUndefined();
  });
});
