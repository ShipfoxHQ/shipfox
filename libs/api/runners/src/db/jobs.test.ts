import {RUNNER_JOB_COMPLETED} from '@shipfox/api-runners-dto';
import {eq, sql} from 'drizzle-orm';
import {completeJob, detectAndFailStuckJobs} from '#core/jobs.js';
import {pendingJobFactory, runnerTokenFactory} from '#test/index.js';
import {db} from './db.js';
import {claimJob, enqueueJob, recordHeartbeat, requestJobCancellation} from './jobs.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobs} from './schema/pending-jobs.js';
import {runningJobs} from './schema/running-jobs.js';

describe('enqueueJob', () => {
  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_outbox CASCADE`,
    );
  });

  it('inserts a row into pending_jobs with correct payload', async () => {
    const jobId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const payload = {
      job_id: jobId,
      run_id: runId,
      job_name: 'build',
      steps: [
        {
          id: crypto.randomUUID(),
          name: 'hello',
          type: 'run',
          config: {run: 'echo hello'},
          position: 0,
        },
      ],
    };

    await enqueueJob({workspaceId, jobId, runId, payload});

    const rows = await db().select().from(pendingJobs);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.jobId).toBe(jobId);
    expect(rows[0]?.runId).toBe(runId);
    expect(rows[0]?.workspaceId).toBe(workspaceId);
    expect(rows[0]?.payload).toEqual(payload);
  });

  it('throws on duplicate job_id', async () => {
    const jobId = crypto.randomUUID();
    const attrs = {workspaceId: crypto.randomUUID(), runId: crypto.randomUUID(), jobId};
    const payload = {job_id: jobId, run_id: attrs.runId, job_name: 'build', steps: []};

    await enqueueJob({...attrs, payload});

    await expect(enqueueJob({...attrs, payload})).rejects.toThrow();
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

  it('returns the job payload when a job is available', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    const claimed = await claimJob({workspaceId, runnerTokenId});

    expect(claimed).not.toBeNull();
    expect(claimed?.jobId).toBe(created.jobId);
    expect(claimed?.runId).toBe(created.runId);
    expect(claimed?.payload.job_name).toBe(created.payload.job_name);
  });

  it('returns null when no jobs are pending', async () => {
    const claimed = await claimJob({workspaceId, runnerTokenId});

    expect(claimed).toBeNull();
  });

  it('only one caller wins when two claim concurrently', async () => {
    const otherRunnerToken = await runnerTokenFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});

    const [claim1, claim2] = await Promise.all([
      claimJob({workspaceId, runnerTokenId}),
      claimJob({workspaceId, runnerTokenId: otherRunnerToken.id}),
    ]);

    const claimed = [claim1, claim2].filter(Boolean);
    expect(claimed).toHaveLength(1);
  });

  it('claims the oldest job first', async () => {
    const older = await pendingJobFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});

    const claimed = await claimJob({workspaceId, runnerTokenId});

    expect(claimed?.jobId).toBe(older.jobId);
  });

  it('moves the job from pending to running', async () => {
    await pendingJobFactory.create({workspaceId});

    await claimJob({workspaceId, runnerTokenId});

    const pending = await db().select().from(pendingJobs);
    const running = await db().select().from(runningJobs);
    expect(pending).toHaveLength(0);
    expect(running).toHaveLength(1);
    expect(running[0]?.runnerTokenId).toBe(runnerTokenId);
  });

  it('does not claim jobs from another workspace', async () => {
    await pendingJobFactory.create({workspaceId: crypto.randomUUID()});

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
    const pending = await pendingJobFactory.create({workspaceId});
    const claimed = await claimJob({workspaceId, runnerTokenId});
    const stepId = pending.payload.steps[0]?.id ?? crypto.randomUUID();

    const result = await completeJob(
      {jobId: claimed?.jobId as string, runnerTokenId},
      succeededResult(stepId),
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
    const pending = await pendingJobFactory.create({workspaceId});
    const claimed = await claimJob({workspaceId, runnerTokenId});
    const stepId = pending.payload.steps[0]?.id ?? crypto.randomUUID();

    await expect(
      completeJob(
        {jobId: claimed?.jobId as string, runnerTokenId: otherRunnerToken.id},
        succeededResult(stepId),
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
    const claimed = await claimJob({workspaceId, runnerTokenId});

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
    const claimed = await claimJob({workspaceId, runnerTokenId});

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
    const claimed = await claimJob({workspaceId, runnerTokenId});

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
    const claimed = await claimJob({workspaceId, runnerTokenId});

    await requestJobCancellation({jobId: claimed?.jobId as string});

    const rows = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    expect(rows[0]?.cancellationRequestedAt).not.toBeNull();
  });

  it('is idempotent: second call preserves the first timestamp', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimJob({workspaceId, runnerTokenId});

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

describe('detectAndFailStuckJobs', () => {
  let workspaceId: string;
  let runnerTokenId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerToken = await runnerTokenFactory.create({workspaceId});
    runnerTokenId = runnerToken.id;
  });

  async function makeStaleJob(staleSeconds: number): Promise<{jobId: string; runId: string}> {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimJob({workspaceId, runnerTokenId});
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

  it('fails a stuck job and writes a runners.job.completed event with empty steps[]', async () => {
    const {jobId, runId} = await makeStaleJob(600);

    const result = await detectAndFailStuckJobs({thresholdSeconds: 180});

    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await runningJobsForTest()).toHaveLength(0);

    const outbox = await outboxForJobs([jobId]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe(RUNNER_JOB_COMPLETED);
    const payload = outbox[0]?.payload as Record<string, unknown>;
    expect(payload.jobId).toBe(jobId);
    expect(payload.runId).toBe(runId);
    expect(payload.status).toBe('failed');
    // Stuck-job detection has no per-step detail; the workflow falls back to
    // bulk-failing every step via the empty-steps path.
    expect(payload.steps).toEqual([]);
    expect(payload.output).toBeUndefined();
  });

  it('does not fail a job whose heartbeat is still inside the threshold window', async () => {
    const {jobId} = await makeStaleJob(60);

    await detectAndFailStuckJobs({thresholdSeconds: 180});

    expect(await runningJobsForTest()).toHaveLength(1);
    expect(await outboxForJobs([jobId])).toHaveLength(0);
  });

  it('only fails the stuck rows in a mixed batch', async () => {
    const stuck1 = await makeStaleJob(600);
    const stuck2 = await makeStaleJob(600);
    const fresh = await makeStaleJob(30);

    await detectAndFailStuckJobs({thresholdSeconds: 180});

    const remaining = await runningJobsForTest();
    expect(remaining.map((r) => r.jobId)).toEqual([fresh.jobId]);
    expect(await outboxForJobs([stuck1.jobId, stuck2.jobId, fresh.jobId])).toHaveLength(2);
  });

  it('returns zero when there are no stuck jobs', async () => {
    const result = await detectAndFailStuckJobs({thresholdSeconds: 180});
    expect(result.failed).toBe(0);
  });

  it('skips a row whose heartbeat refreshed before the atomic DELETE re-evaluates the predicate', async () => {
    // Pre-stale, then refresh, then run — the cutoff is folded into the DELETE's
    // WHERE so the live row survives even though the iteration SELECT saw it stale.
    const {jobId} = await makeStaleJob(600);
    await db()
      .update(runningJobs)
      .set({lastHeartbeatAt: sql`now()`})
      .where(eq(runningJobs.jobId, jobId));

    await detectAndFailStuckJobs({thresholdSeconds: 180});

    expect(await runningJobsForTest()).toHaveLength(1);
    expect(await outboxForJobs([jobId])).toHaveLength(0);
  });
});
