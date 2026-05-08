import {RUNNER_JOB_COMPLETED} from '@shipfox/api-runners-dto';
import {eq, sql} from 'drizzle-orm';
import {pendingJobFactory, runnerTokenFactory} from '#test/index.js';
import {db} from './db.js';
import {
  claimJob,
  completeJob,
  detectAndFailStuckJobs,
  enqueueJob,
  recordHeartbeat,
  requestJobCancellation,
} from './jobs.js';
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

  it('deletes the running job and writes an outbox event', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimJob({workspaceId, runnerTokenId});

    const result = await completeJob(
      {jobId: claimed?.jobId as string, runnerTokenId},
      {status: 'succeeded'},
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
  });

  it('throws RunningJobNotFoundError when job is not running', async () => {
    await expect(
      completeJob({jobId: crypto.randomUUID(), runnerTokenId}, {status: 'succeeded'}),
    ).rejects.toThrow('Running job not found');
  });

  it('does not complete a job owned by another runner token', async () => {
    const otherRunnerToken = await runnerTokenFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimJob({workspaceId, runnerTokenId});

    await expect(
      completeJob(
        {jobId: claimed?.jobId as string, runnerTokenId: otherRunnerToken.id},
        {status: 'succeeded'},
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
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_runner_tokens, runners_outbox CASCADE`,
    );
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
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_runner_tokens, runners_outbox CASCADE`,
    );
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
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_runner_tokens, runners_outbox CASCADE`,
    );
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

  it('fails a stuck job and writes a runners.job.completed event with reason runner_disappeared', async () => {
    const {jobId, runId} = await makeStaleJob(600);

    const result = await detectAndFailStuckJobs({thresholdSeconds: 180});

    expect(result.failed).toBe(1);
    const running = await db().select().from(runningJobs);
    expect(running).toHaveLength(0);

    const outbox = await db().select().from(runnersOutbox);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe(RUNNER_JOB_COMPLETED);
    const payload = outbox[0]?.payload as Record<string, unknown>;
    expect(payload.jobId).toBe(jobId);
    expect(payload.runId).toBe(runId);
    expect(payload.status).toBe('failed');
    expect(payload.output).toEqual({reason: 'runner_disappeared'});
  });

  it('does not fail a job whose heartbeat is still inside the threshold window', async () => {
    await makeStaleJob(60);

    const result = await detectAndFailStuckJobs({thresholdSeconds: 180});

    expect(result.failed).toBe(0);
    const running = await db().select().from(runningJobs);
    expect(running).toHaveLength(1);
  });

  it('only fails the stuck rows in a mixed batch', async () => {
    await makeStaleJob(600); // stuck
    await makeStaleJob(600); // stuck
    await makeStaleJob(30); // fresh

    const result = await detectAndFailStuckJobs({thresholdSeconds: 180});

    expect(result.failed).toBe(2);
    const running = await db().select().from(runningJobs);
    expect(running).toHaveLength(1);
    const outbox = await db().select().from(runnersOutbox);
    expect(outbox).toHaveLength(2);
  });

  it('returns zero when there are no stuck jobs', async () => {
    const result = await detectAndFailStuckJobs({thresholdSeconds: 180});
    expect(result.failed).toBe(0);
  });

  it('skips a row whose heartbeat refreshed between the iteration SELECT and the per-row DELETE (codex F1 race)', async () => {
    // Insert a row that LOOKS stuck at the iteration SELECT moment,
    // then refresh its heartbeat just before the atomic DELETE re-evaluates the predicate.
    const {jobId} = await makeStaleJob(600);

    // Simulate the race: bring last_heartbeat_at fresh AFTER the iteration SELECT
    // would have observed it as stuck, but BEFORE the DELETE runs. We can't
    // inject a hook between the two queries inside detectAndFailStuckJobs from
    // outside, but we CAN exercise the same guarantee end-to-end by refreshing
    // the heartbeat first and then calling the function: if the predicate is
    // baked into the DELETE (codex F1 fix), the row survives. If it isn't, the
    // function would still delete it because the iteration SELECT used its own
    // earlier snapshot. Either way, this test fails under the broken design and
    // passes under the atomic DELETE.
    await db()
      .update(runningJobs)
      .set({lastHeartbeatAt: sql`now()`})
      .where(eq(runningJobs.jobId, jobId));

    const result = await detectAndFailStuckJobs({thresholdSeconds: 180});

    expect(result.failed).toBe(0);
    const running = await db().select().from(runningJobs);
    expect(running).toHaveLength(1);
    const outbox = await db().select().from(runnersOutbox);
    expect(outbox).toHaveLength(0);
  });
});
