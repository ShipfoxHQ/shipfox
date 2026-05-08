import {WORKFLOWS_JOB_TIMED_OUT} from '@shipfox/api-workflows-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {claimJob} from '#db/jobs.js';
import {runningJobs} from '#db/schema/running-jobs.js';
import {pendingJobFactory, runnerTokenFactory} from '#test/index.js';
import {onWorkflowsJobTimedOut} from './on-workflows-job-timed-out.js';

function buildEvent(jobId: string, runId: string): DomainEvent {
  return {
    id: crypto.randomUUID(),
    type: WORKFLOWS_JOB_TIMED_OUT,
    payload: {jobId, runId},
    createdAt: new Date(),
  };
}

describe('onWorkflowsJobTimedOut', () => {
  let workspaceId: string;
  let runnerTokenId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerToken = await runnerTokenFactory.create({workspaceId});
    runnerTokenId = runnerToken.id;
  });

  it('sets cancellation_requested_at on the matching running_jobs row', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimJob({workspaceId, runnerTokenId});
    expect(claimed).not.toBeNull();

    await onWorkflowsJobTimedOut(buildEvent(claimed?.jobId as string, claimed?.runId as string));

    const rows = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    expect(rows[0]?.cancellationRequestedAt).not.toBeNull();
  });

  it('idempotent under double delivery: second call preserves the first timestamp', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimJob({workspaceId, runnerTokenId});

    await onWorkflowsJobTimedOut(buildEvent(claimed?.jobId as string, claimed?.runId as string));
    const after1 = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    const firstTs = after1[0]?.cancellationRequestedAt;

    await new Promise((r) => setTimeout(r, 10));
    await onWorkflowsJobTimedOut(buildEvent(claimed?.jobId as string, claimed?.runId as string));

    const after2 = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    expect(after2[0]?.cancellationRequestedAt?.getTime()).toBe(firstTs?.getTime());
  });

  it('no-op when the running_jobs row is gone (already finalized)', async () => {
    // Row was finalized by another path before the event reached us.
    await expect(
      onWorkflowsJobTimedOut(buildEvent(crypto.randomUUID(), crypto.randomUUID())),
    ).resolves.toBeUndefined();
  });
});
