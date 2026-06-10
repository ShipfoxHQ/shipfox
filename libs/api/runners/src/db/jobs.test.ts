import {verifyJobLeaseToken} from '@shipfox/api-auth';
import {RUNNER_JOB_COMPLETED, RUNNER_JOB_LEASE_EXPIRED} from '@shipfox/api-runners-dto';
import {eq, sql} from 'drizzle-orm';
import {claimJob, completeJob, detectAndExpireStuckJobs} from '#core/jobs.js';
import {pendingJobFactory, runnerTokenFactory} from '#test/index.js';
import {db} from './db.js';
import {
  claimPendingJob,
  expireStuckJob,
  recordHeartbeat,
  requestJobCancellation,
  scheduleJob,
} from './jobs.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobs} from './schema/pending-jobs.js';
import {runningJobs} from './schema/running-jobs.js';

describe('scheduleJob', () => {
  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_outbox CASCADE`,
    );
  });

  it('stores a pending assignment row', async () => {
    const jobId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();

    await scheduleJob({workspaceId, jobId, runId});

    const rows = await db().select().from(pendingJobs);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.jobId).toBe(jobId);
    expect(rows[0]?.runId).toBe(runId);
    expect(rows[0]?.workspaceId).toBe(workspaceId);
    expect(rows[0]).not.toHaveProperty('payload');
  });

  it('is idempotent: scheduling the same jobId twice is a no-op', async () => {
    const jobId = crypto.randomUUID();
    const params = {workspaceId: crypto.randomUUID(), runId: crypto.randomUUID(), jobId};

    await scheduleJob(params);
    await expect(scheduleJob(params)).resolves.toBeUndefined();

    const rows = await db().select().from(pendingJobs);
    expect(rows).toHaveLength(1);
  });
});

describe('claimPendingJob', () => {
  let workspaceId: string;
  let runnerTokenId: string;

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_runner_tokens CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    const runnerToken = await runnerTokenFactory.create({workspaceId});
    runnerTokenId = runnerToken.id;
  });

  it('returns the job ids when a job is available', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    const claimed = await claimPendingJob({workspaceId, runnerTokenId});

    expect(claimed).not.toBeNull();
    expect(claimed?.jobId).toBe(created.jobId);
    expect(claimed?.runId).toBe(created.runId);
  });

  it('returns null when no jobs are pending', async () => {
    const claimed = await claimPendingJob({workspaceId, runnerTokenId});

    expect(claimed).toBeNull();
  });

  it('only one caller wins when two claim concurrently', async () => {
    const otherRunnerToken = await runnerTokenFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});

    const [claim1, claim2] = await Promise.all([
      claimPendingJob({workspaceId, runnerTokenId}),
      claimPendingJob({workspaceId, runnerTokenId: otherRunnerToken.id}),
    ]);

    const claimed = [claim1, claim2].filter(Boolean);
    expect(claimed).toHaveLength(1);
  });

  it('claims the oldest job first', async () => {
    const older = await pendingJobFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});

    const claimed = await claimPendingJob({workspaceId, runnerTokenId});

    expect(claimed?.jobId).toBe(older.jobId);
  });

  it('moves the job from pending to running', async () => {
    await pendingJobFactory.create({workspaceId});

    await claimPendingJob({workspaceId, runnerTokenId});

    const pending = await db().select().from(pendingJobs);
    const running = await db().select().from(runningJobs);
    expect(pending).toHaveLength(0);
    expect(running).toHaveLength(1);
    expect(running[0]?.runnerTokenId).toBe(runnerTokenId);
  });

  it('does not claim jobs from another workspace', async () => {
    await pendingJobFactory.create({workspaceId: crypto.randomUUID()});

    const claimed = await claimPendingJob({workspaceId, runnerTokenId});

    expect(claimed).toBeNull();
  });
});

describe('claimJob', () => {
  let workspaceId: string;
  let runnerTokenId: string;

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_runner_tokens CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    const runnerToken = await runnerTokenFactory.create({workspaceId});
    runnerTokenId = runnerToken.id;
  });

  it('mints a lease token whose claims match the claimed job', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    const claimed = await claimJob({workspaceId, runnerTokenId});

    expect(claimed).not.toBeNull();
    expect(claimed?.jobId).toBe(created.jobId);
    expect(claimed?.runId).toBe(created.runId);
    expect(claimed).not.toHaveProperty('steps');

    const claims = await verifyJobLeaseToken(claimed?.leaseToken as string);
    expect(claims).toMatchObject({
      jobId: created.jobId,
      runId: created.runId,
      workspaceId,
      runnerTokenId,
    });
  });

  it('returns null and mints no token when the queue is empty', async () => {
    const claimed = await claimJob({workspaceId, runnerTokenId});

    expect(claimed).toBeNull();
  });
});

describe('completeJob', () => {
  let workspaceId: string;
  let runnerTokenId: string;

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_runner_tokens, runners_outbox CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    const runnerToken = await runnerTokenFactory.create({workspaceId});
    runnerTokenId = runnerToken.id;
  });

  function succeededResult(stepId: string) {
    return {
      status: 'succeeded' as const,
      steps: [{step_id: stepId, status: 'succeeded' as const, error: null}],
    };
  }

  it('deletes the running job and writes an outbox event', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerTokenId});

    const result = await completeJob(
      {jobId: claimed?.jobId as string, runnerTokenId},
      succeededResult(crypto.randomUUID()),
    );

    expect(result.runId).toBe(claimed?.runId as string);

    const running = await db().select().from(runningJobs);
    expect(running).toHaveLength(0);

    const outboxRows = await db().select().from(runnersOutbox);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.eventType).toBe(RUNNER_JOB_COMPLETED);
    const payload = outboxRows[0]?.payload as Record<string, unknown>;
    expect(payload.jobId).toBe(claimed?.jobId as string);
    expect(payload.runId).toBe(claimed?.runId as string);
    expect(payload.status).toBe('succeeded');
    expect(payload.steps).toHaveLength(1);
  });

  it('throws RunningJobNotFoundError when job is not running', async () => {
    await expect(
      completeJob(
        {jobId: crypto.randomUUID(), runnerTokenId},
        succeededResult(crypto.randomUUID()),
      ),
    ).rejects.toThrow('Running job not found');
  });

  it('does not complete a job owned by another runner token', async () => {
    const otherRunnerToken = await runnerTokenFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerTokenId});

    await expect(
      completeJob(
        {jobId: claimed?.jobId as string, runnerTokenId: otherRunnerToken.id},
        succeededResult(crypto.randomUUID()),
      ),
    ).rejects.toThrow('Running job not found');

    const running = await db().select().from(runningJobs);
    const outboxRows = await db().select().from(runnersOutbox);
    expect(running).toHaveLength(1);
    expect(outboxRows).toHaveLength(0);
  });
});

describe('recordHeartbeat', () => {
  let workspaceId: string;
  let runnerTokenId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerToken = await runnerTokenFactory.create({workspaceId});
    runnerTokenId = runnerToken.id;
  });

  it('returns cancel:false on a fresh row and bumps last_heartbeat_at', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerTokenId});

    const before = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    // Force last_heartbeat_at into the past so we can observe the update.
    await db()
      .update(runningJobs)
      .set({lastHeartbeatAt: sql`now() - interval '1 hour'`})
      .where(eq(runningJobs.jobId, claimed?.jobId as string));

    const result = await recordHeartbeat({
      jobId: claimed?.jobId as string,
      runnerTokenId,
    });

    expect(result).toEqual({cancellationRequested: false});

    const after = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    expect(after[0]?.lastHeartbeatAt.getTime()).toBeGreaterThan(
      (before[0]?.lastHeartbeatAt.getTime() ?? 0) - 1,
    );
  });

  it('returns cancel:true after requestJobCancellation', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerTokenId});

    await requestJobCancellation({jobId: claimed?.jobId as string});

    const result = await recordHeartbeat({
      jobId: claimed?.jobId as string,
      runnerTokenId,
    });

    expect(result).toEqual({cancellationRequested: true});
  });

  it('throws RunningJobNotFoundError when jobId is unknown', async () => {
    await expect(recordHeartbeat({jobId: crypto.randomUUID(), runnerTokenId})).rejects.toThrow(
      'Running job not found',
    );
  });

  it('throws when jobId belongs to a different runner token', async () => {
    const otherRunnerToken = await runnerTokenFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerTokenId});

    await expect(
      recordHeartbeat({
        jobId: claimed?.jobId as string,
        runnerTokenId: otherRunnerToken.id,
      }),
    ).rejects.toThrow('Running job not found');
  });
});

describe('requestJobCancellation', () => {
  let workspaceId: string;
  let runnerTokenId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerToken = await runnerTokenFactory.create({workspaceId});
    runnerTokenId = runnerToken.id;
  });

  it('sets cancellation_requested_at on a fresh row', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerTokenId});

    await requestJobCancellation({jobId: claimed?.jobId as string});

    const rows = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    expect(rows[0]?.cancellationRequestedAt).not.toBeNull();
  });

  it('is idempotent: second call preserves the first timestamp', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerTokenId});

    await requestJobCancellation({jobId: claimed?.jobId as string});
    const after1 = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    const firstTs = after1[0]?.cancellationRequestedAt;

    await new Promise((r) => setTimeout(r, 10));
    await requestJobCancellation({jobId: claimed?.jobId as string});

    const after2 = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    expect(after2[0]?.cancellationRequestedAt?.getTime()).toBe(firstTs?.getTime());
  });

  it('is a no-op when the job is missing (does not throw)', async () => {
    await expect(requestJobCancellation({jobId: crypto.randomUUID()})).resolves.toBeUndefined();
  });
});

describe('detectAndExpireStuckJobs', () => {
  let workspaceId: string;
  let runnerTokenId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerToken = await runnerTokenFactory.create({workspaceId});
    runnerTokenId = runnerToken.id;
  });

  async function makeStaleJob(staleSeconds: number): Promise<{jobId: string; runId: string}> {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerTokenId});
    await db()
      .update(runningJobs)
      .set({
        lastHeartbeatAt: sql`now() - (${staleSeconds} || ' seconds')::interval`,
      })
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    return {jobId: claimed?.jobId as string, runId: claimed?.runId as string};
  }

  async function runningJobsForTest() {
    return await db().select().from(runningJobs).where(eq(runningJobs.workspaceId, workspaceId));
  }

  async function outboxForJobs(jobIds: string[]) {
    const all = await db().select().from(runnersOutbox);
    return all.filter((row) => {
      const payload = row.payload as {jobId?: string};
      return payload.jobId !== undefined && jobIds.includes(payload.jobId);
    });
  }

  it('expires a stuck job and writes a runners.job.lease_expired event', async () => {
    const {jobId, runId} = await makeStaleJob(600);

    const result = await detectAndExpireStuckJobs({thresholdSeconds: 180});

    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(await runningJobsForTest()).toHaveLength(0);

    const outbox = await outboxForJobs([jobId]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe(RUNNER_JOB_LEASE_EXPIRED);
    const payload = outbox[0]?.payload as Record<string, unknown>;
    expect(payload.jobId).toBe(jobId);
    expect(payload.runId).toBe(runId);
    // The lease-expired event carries only the assignment identifiers.
    expect(payload.status).toBeUndefined();
    expect(payload.steps).toBeUndefined();
  });

  it('does not expire a job whose heartbeat is still inside the threshold window', async () => {
    const {jobId} = await makeStaleJob(60);

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    expect(await runningJobsForTest()).toHaveLength(1);
    expect(await outboxForJobs([jobId])).toHaveLength(0);
  });

  it('only expires the stuck rows in a mixed batch', async () => {
    const stuck1 = await makeStaleJob(600);
    const stuck2 = await makeStaleJob(600);
    const fresh = await makeStaleJob(30);

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    const remaining = await runningJobsForTest();
    expect(remaining.map((r) => r.jobId)).toEqual([fresh.jobId]);
    expect(await outboxForJobs([stuck1.jobId, stuck2.jobId, fresh.jobId])).toHaveLength(2);
  });

  it('returns zero when there are no stuck jobs', async () => {
    const result = await detectAndExpireStuckJobs({thresholdSeconds: 180});
    expect(result.expired).toBe(0);
  });

  it('skips a row whose heartbeat refreshed before the atomic DELETE re-evaluates the predicate', async () => {
    // Pre-stale, then refresh, then run — the cutoff is folded into the DELETE's
    // WHERE so the live row survives even though the iteration SELECT saw it stale.
    const {jobId} = await makeStaleJob(600);
    await db()
      .update(runningJobs)
      .set({lastHeartbeatAt: sql`now()`})
      .where(eq(runningJobs.jobId, jobId));

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    expect(await runningJobsForTest()).toHaveLength(1);
    expect(await outboxForJobs([jobId])).toHaveLength(0);
  });

  it('double-expiring the same stuck job emits exactly one event', async () => {
    const {jobId} = await makeStaleJob(600);

    const first = await expireStuckJob({jobId, staleBeforeMs: 180_000});
    const second = await expireStuckJob({jobId, staleBeforeMs: 180_000});

    expect(first).toBeDefined();
    expect(second).toBeUndefined();
    expect(await outboxForJobs([jobId])).toHaveLength(1);
  });
});
