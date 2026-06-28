import {verifyJobLeaseToken} from '@shipfox/api-auth';
import {
  RUNNER_JOB_CLAIMED,
  RUNNER_JOB_LEASE_EXPIRED,
  RUNNER_JOB_QUEUED,
} from '@shipfox/api-runners-dto';
import {eq, sql} from 'drizzle-orm';
import {EmptyRequiredLabelsError, RunnerSessionExhaustedError} from '#core/errors.js';
import {claimJob, detectAndExpireStuckJobs} from '#core/jobs.js';
import {pendingJobFactory, runnerSessionFactory} from '#test/index.js';
import {db} from './db.js';
import {
  cancelRunnerJobs,
  claimPendingJob as claimPendingJobDb,
  enqueueJob,
  expireStuckJobs,
  getJobQueueDepth,
  recordHeartbeat,
  releaseJob,
  requestJobCancellation,
} from './jobs.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobs} from './schema/pending-jobs.js';
import {runnerSessions} from './schema/runner-sessions.js';
import {runningJobs} from './schema/running-jobs.js';

const sessionLabels = ['linux', 'x64'];

function claimPendingJob(
  params: Omit<Parameters<typeof claimPendingJobDb>[0], 'maxClaims' | 'sessionLabels'> & {
    maxClaims?: number | null;
    sessionLabels?: string[];
  },
) {
  return claimPendingJobDb({
    ...params,
    maxClaims: params.maxClaims ?? null,
    sessionLabels: params.sessionLabels ?? sessionLabels,
  });
}

describe('enqueueJob', () => {
  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_ephemeral_registration_tokens, runners_pending_jobs, runners_running_jobs, runners_runner_sessions, runners_outbox CASCADE`,
    );
  });

  it('stores a pending assignment row', async () => {
    const jobId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();

    await enqueueJob({workspaceId, jobId, runId, projectId, requiredLabels: ['linux']});

    const rows = await db().select().from(pendingJobs);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.jobId).toBe(jobId);
    expect(rows[0]?.runId).toBe(runId);
    expect(rows[0]?.projectId).toBe(projectId);
    expect(rows[0]?.workspaceId).toBe(workspaceId);
    expect(rows[0]?.requiredLabels).toEqual(['linux']);
    expect(rows[0]).not.toHaveProperty('payload');
  });

  it('stores canonical required labels', async () => {
    const jobId = crypto.randomUUID();

    await enqueueJob({
      workspaceId: crypto.randomUUID(),
      jobId,
      runId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      requiredLabels: ['Ubuntu22', ' ubuntu22 ', 'LINUX'],
    });

    const rows = await db().select().from(pendingJobs).where(eq(pendingJobs.jobId, jobId));
    expect(rows[0]?.requiredLabels).toEqual(['linux', 'ubuntu22']);
  });

  it('rejects empty required labels', async () => {
    await expect(
      enqueueJob({
        workspaceId: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        runId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        requiredLabels: [],
      }),
    ).rejects.toBeInstanceOf(EmptyRequiredLabelsError);
  });

  it('is idempotent: scheduling the same jobId twice is a no-op', async () => {
    const jobId = crypto.randomUUID();
    const params = {
      workspaceId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      jobId,
      requiredLabels: ['linux'],
    };

    await enqueueJob(params);
    await expect(enqueueJob(params)).resolves.toBeUndefined();

    const rows = await db().select().from(pendingJobs);
    expect(rows).toHaveLength(1);
  });

  it('emits runners.job.queued carrying the pending row created_at', async () => {
    const jobId = crypto.randomUUID();
    const runId = crypto.randomUUID();

    await enqueueJob({
      workspaceId: crypto.randomUUID(),
      jobId,
      runId,
      projectId: crypto.randomUUID(),
      requiredLabels: ['linux'],
    });

    const [pending] = await db().select().from(pendingJobs);
    const outbox = await db().select().from(runnersOutbox);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe(RUNNER_JOB_QUEUED);
    const payload = outbox[0]?.payload as {jobId: string; runId: string; queuedAt: string};
    expect(payload.jobId).toBe(jobId);
    expect(payload.runId).toBe(runId);
    expect(new Date(payload.queuedAt).getTime()).toBe(pending?.createdAt.getTime());
  });

  it('does not double-emit queued when the same jobId is re-enqueued (idempotency regression)', async () => {
    const params = {
      workspaceId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      requiredLabels: ['linux'],
    };

    await enqueueJob(params);
    await enqueueJob(params);

    expect(await db().select().from(pendingJobs)).toHaveLength(1);
    expect(await db().select().from(runnersOutbox)).toHaveLength(1);
  });
});

describe('claimPendingJob', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_ephemeral_registration_tokens, runners_pending_jobs, runners_running_jobs, runners_runner_sessions, runners_runner_tokens, runners_outbox CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('emits runners.job.claimed carrying the claim instant on a real claim', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    const [running] = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    const outbox = await db()
      .select()
      .from(runnersOutbox)
      .where(eq(runnersOutbox.eventType, RUNNER_JOB_CLAIMED));
    expect(outbox).toHaveLength(1);
    const payload = outbox[0]?.payload as {jobId: string; runId: string; claimedAt: string};
    expect(payload.jobId).toBe(created.jobId);
    expect(payload.runId).toBe(created.runId);
    expect(new Date(payload.claimedAt).getTime()).toBe(running?.startedAt.getTime());
  });

  it('emits no claimed event when there is nothing to claim', async () => {
    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    expect(claimed).toBeNull();
    expect(
      await db()
        .select()
        .from(runnersOutbox)
        .where(eq(runnersOutbox.eventType, RUNNER_JOB_CLAIMED)),
    ).toHaveLength(0);
  });

  it('emits no claimed event when dropping an orphan pending row', async () => {
    const created = await pendingJobFactory.create({workspaceId});
    await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});
    await db().insert(pendingJobs).values({
      workspaceId,
      jobId: created.jobId,
      runId: created.runId,
      projectId: created.projectId,
      requiredLabels: created.requiredLabels,
    });
    // Clear the initial claim's events so this assertion only covers the orphan claim.
    await db().delete(runnersOutbox);

    const second = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    expect(second).toBeNull();
    expect(await db().select().from(runnersOutbox)).toHaveLength(0);
  });

  it('returns the job ids when a job is available', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    expect(claimed).not.toBeNull();
    expect(claimed?.jobId).toBe(created.jobId);
    expect(claimed?.runId).toBe(created.runId);
    expect(claimed?.projectId).toBe(created.projectId);
  });

  it('returns null when no jobs are pending', async () => {
    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    expect(claimed).toBeNull();
  });

  it('enforces a non-null session claim cap from the database', async () => {
    await db()
      .update(runnerSessions)
      .set({registrationTokenKind: 'ephemeral', maxClaims: 1})
      .where(eq(runnerSessions.id, runnerSessionId));
    await pendingJobFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});

    const first = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: 1});

    expect(first).not.toBeNull();
    await expect(
      claimPendingJob({workspaceId, runnerSessionId, maxClaims: 1}),
    ).rejects.toBeInstanceOf(RunnerSessionExhaustedError);
  });

  it('does not spend a claim when a capped session polls an empty queue', async () => {
    await db()
      .update(runnerSessions)
      .set({registrationTokenKind: 'ephemeral', maxClaims: 1})
      .where(eq(runnerSessions.id, runnerSessionId));

    const empty = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: 1});

    const [afterEmpty] = await db()
      .select({claimsUsed: runnerSessions.claimsUsed})
      .from(runnerSessions)
      .where(eq(runnerSessions.id, runnerSessionId));
    expect(empty).toBeNull();
    expect(afterEmpty?.claimsUsed).toBe(0);

    const created = await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: 1});

    const [afterClaim] = await db()
      .select({claimsUsed: runnerSessions.claimsUsed})
      .from(runnerSessions)
      .where(eq(runnerSessions.id, runnerSessionId));
    expect(claimed?.jobId).toBe(created.jobId);
    expect(afterClaim?.claimsUsed).toBe(1);
  });

  it('allows a manual session to claim repeatedly', async () => {
    const first = await pendingJobFactory.create({workspaceId});
    const second = await pendingJobFactory.create({workspaceId});

    const firstClaim = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});
    const secondClaim = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    expect(firstClaim?.jobId).toBe(first.jobId);
    expect(secondClaim?.jobId).toBe(second.jobId);
  });

  it('only one caller wins when two claim concurrently', async () => {
    const otherRunnerSession = await runnerSessionFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});

    const [claim1, claim2] = await Promise.all([
      claimPendingJob({workspaceId, runnerSessionId, maxClaims: null}),
      claimPendingJob({
        workspaceId,
        runnerSessionId: otherRunnerSession.id,
        maxClaims: null,
      }),
    ]);

    const claimed = [claim1, claim2].filter(Boolean);
    expect(claimed).toHaveLength(1);
  });

  it('claims the oldest job first', async () => {
    const older = await pendingJobFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});

    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    expect(claimed?.jobId).toBe(older.jobId);
  });

  it('moves the job from pending to running', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    const pending = await db().select().from(pendingJobs);
    const running = await db().select().from(runningJobs);
    expect(pending).toHaveLength(0);
    expect(running).toHaveLength(1);
    expect(running[0]?.runnerSessionId).toBe(runnerSessionId);
    expect(running[0]?.projectId).toBe(created.projectId);
    expect(running[0]?.requiredLabels).toEqual(created.requiredLabels);
    expect(running[0]?.runnerLabels).toEqual(sessionLabels);
  });

  it('claims a job whose required labels are a subset of the session labels', async () => {
    const created = await pendingJobFactory.create({
      workspaceId,
      requiredLabels: ['linux'],
    });

    const claimed = await claimPendingJob({workspaceId, runnerSessionId});

    expect(claimed?.jobId).toBe(created.jobId);
  });

  it('claims a job whose required labels exactly match the session labels', async () => {
    const created = await pendingJobFactory.create({
      workspaceId,
      requiredLabels: ['linux', 'x64'],
    });

    const claimed = await claimPendingJob({workspaceId, runnerSessionId});

    expect(claimed?.jobId).toBe(created.jobId);
  });

  it('skips an older incompatible job and claims the oldest compatible job', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['macos']});
    const compatible = await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});
    await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    const claimed = await claimPendingJob({workspaceId, runnerSessionId});

    expect(claimed?.jobId).toBe(compatible.jobId);
  });

  it('claims the older matching job before newer matching jobs', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['macos']});
    const olderMatching = await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});
    await pendingJobFactory.create({workspaceId, requiredLabels: ['x64']});

    const claimed = await claimPendingJob({workspaceId, runnerSessionId});

    expect(claimed?.jobId).toBe(olderMatching.jobId);
  });

  it('returns null when no compatible job is pending', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['macos']});

    const claimed = await claimPendingJob({workspaceId, runnerSessionId});

    expect(claimed).toBeNull();
  });

  it('returns null for an empty session label set', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    const claimed = await claimPendingJob({workspaceId, runnerSessionId, sessionLabels: []});

    expect(claimed).toBeNull();
  });

  it('claims the compatible row from a mixed-label queue', async () => {
    for (let index = 0; index < 8; index += 1) {
      await pendingJobFactory.create({workspaceId, requiredLabels: [`gpu-${index}`]});
    }
    const compatible = await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    const claimed = await claimPendingJob({workspaceId, runnerSessionId});

    expect(claimed?.jobId).toBe(compatible.jobId);
  });

  it('does not claim jobs from another workspace', async () => {
    await pendingJobFactory.create({workspaceId: crypto.randomUUID()});

    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    expect(claimed).toBeNull();
  });

  it('drops an orphan pending row whose job is already running, without a poison loop', async () => {
    const created = await pendingJobFactory.create({workspaceId});
    const first = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});
    expect(first?.jobId).toBe(created.jobId);

    // Simulate an enqueue retry that re-inserts a pending row after the claim.
    await db().insert(pendingJobs).values({
      workspaceId,
      jobId: created.jobId,
      runId: created.runId,
      projectId: created.projectId,
      requiredLabels: created.requiredLabels,
    });

    const second = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    expect(second).toBeNull();
    expect(await db().select().from(pendingJobs)).toHaveLength(0);
    const running = await db().select().from(runningJobs);
    expect(running).toHaveLength(1);
    expect(running[0]?.jobId).toBe(created.jobId);
  });

  it('leaves a non-matching orphan unclaimed until release sweeps it', async () => {
    const created = await pendingJobFactory.create({workspaceId});
    const first = await claimPendingJob({workspaceId, runnerSessionId});
    expect(first?.jobId).toBe(created.jobId);
    await db().insert(pendingJobs).values({
      workspaceId,
      jobId: created.jobId,
      runId: created.runId,
      projectId: created.projectId,
      requiredLabels: created.requiredLabels,
    });

    const second = await claimPendingJob({
      workspaceId,
      runnerSessionId,
      sessionLabels: ['macos'],
    });
    await releaseJob({jobId: created.jobId});

    expect(second).toBeNull();
    expect(await db().select().from(runningJobs)).toHaveLength(0);
    expect(await db().select().from(pendingJobs)).toHaveLength(0);
  });

  it('claims a real pending job ahead of a newer orphan', async () => {
    const alreadyRunning = await pendingJobFactory.create({workspaceId});
    await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    // A genuinely new pending job (older), then an orphan re-insert for the running job (newer).
    const real = await pendingJobFactory.create({workspaceId});
    await db().insert(pendingJobs).values({
      workspaceId,
      jobId: alreadyRunning.jobId,
      runId: alreadyRunning.runId,
      projectId: alreadyRunning.projectId,
      requiredLabels: alreadyRunning.requiredLabels,
    });

    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    expect(claimed?.jobId).toBe(real.jobId);
  });
});

describe('claimJob', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_ephemeral_registration_tokens, runners_pending_jobs, runners_running_jobs, runners_runner_sessions, runners_runner_tokens CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('mints a lease token whose claims match the claimed job', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    const claimed = await claimJob({workspaceId, runnerSessionId, sessionLabels, maxClaims: null});

    expect(claimed).not.toBeNull();
    expect(claimed?.jobId).toBe(created.jobId);
    expect(claimed?.runId).toBe(created.runId);
    expect(claimed).not.toHaveProperty('steps');

    const claims = await verifyJobLeaseToken(claimed?.leaseToken as string);
    expect(claims).toMatchObject({
      jobId: created.jobId,
      runId: created.runId,
      projectId: created.projectId,
      workspaceId,
      runnerSessionId,
    });
  });

  it('returns null and mints no token when the queue is empty', async () => {
    const claimed = await claimJob({workspaceId, runnerSessionId, sessionLabels, maxClaims: null});

    expect(claimed).toBeNull();
  });
});

describe('releaseJob', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_ephemeral_registration_tokens, runners_pending_jobs, runners_running_jobs, runners_runner_sessions, runners_runner_tokens, runners_outbox CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('deletes the running row and writes no outbox event', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});
    const before = await db().select().from(runnersOutbox);

    await releaseJob({jobId: claimed?.jobId as string});

    expect(await db().select().from(runningJobs)).toHaveLength(0);
    expect(await db().select().from(runnersOutbox)).toHaveLength(before.length);
  });

  it('is a no-op when the job is absent (idempotent)', async () => {
    await expect(releaseJob({jobId: crypto.randomUUID()})).resolves.toBeUndefined();
  });

  it('releases regardless of which session holds the lease', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    // No token is passed: the workflow is authoritative over the lease.
    await releaseJob({jobId: claimed?.jobId as string});

    expect(await db().select().from(runningJobs)).toHaveLength(0);
  });

  it('also sweeps a lingering pending row for the same job', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});
    // An orphan pending row left by a post-claim enqueue retry.
    await db()
      .insert(pendingJobs)
      .values({
        workspaceId,
        jobId: claimed?.jobId as string,
        runId: claimed?.runId as string,
        projectId: claimed?.projectId as string,
        requiredLabels: ['linux'],
      });

    await releaseJob({jobId: claimed?.jobId as string});

    expect(await db().select().from(runningJobs)).toHaveLength(0);
    expect(await db().select().from(pendingJobs)).toHaveLength(0);
  });
});

describe('recordHeartbeat', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('returns cancel:false on a fresh row and bumps last_heartbeat_at', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

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
      runnerSessionId,
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
    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    await requestJobCancellation({jobId: claimed?.jobId as string});

    const result = await recordHeartbeat({
      jobId: claimed?.jobId as string,
      runnerSessionId,
    });

    expect(result).toEqual({cancellationRequested: true});
  });

  it('throws RunningJobNotFoundError when jobId is unknown', async () => {
    await expect(recordHeartbeat({jobId: crypto.randomUUID(), runnerSessionId})).rejects.toThrow(
      'Running job not found',
    );
  });

  it('throws when jobId belongs to a different session', async () => {
    const otherRunnerSession = await runnerSessionFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    await expect(
      recordHeartbeat({
        jobId: claimed?.jobId as string,
        runnerSessionId: otherRunnerSession.id,
      }),
    ).rejects.toThrow('Running job not found');
  });
});

describe('requestJobCancellation', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('sets cancellation_requested_at on a fresh row', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    await requestJobCancellation({jobId: claimed?.jobId as string});

    const rows = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    expect(rows[0]?.cancellationRequestedAt).not.toBeNull();
  });

  it('is idempotent: second call preserves the first timestamp', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

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

describe('cancelRunnerJobs', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_ephemeral_registration_tokens, runners_pending_jobs, runners_running_jobs, runners_runner_sessions, runners_runner_tokens, runners_outbox CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('deletes queued jobs and requests cancellation for running jobs', async () => {
    const running = await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});
    const queued = await pendingJobFactory.create({workspaceId});

    await cancelRunnerJobs({jobIds: [queued.jobId, claimed?.jobId as string]});

    expect(await db().select().from(pendingJobs)).toHaveLength(0);
    const rows = await db().select().from(runningJobs);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.jobId).toBe(running.jobId);
    expect(rows[0]?.cancellationRequestedAt).not.toBeNull();
  });

  it('is idempotent and no-ops for absent jobs', async () => {
    const queued = await pendingJobFactory.create({workspaceId});

    await cancelRunnerJobs({jobIds: [queued.jobId, crypto.randomUUID()]});
    await cancelRunnerJobs({jobIds: [queued.jobId, crypto.randomUUID()]});

    expect(await db().select().from(pendingJobs)).toHaveLength(0);
    expect(await db().select().from(runningJobs)).toHaveLength(0);
  });

  it('prevents a cancelled queued job from being claimed', async () => {
    const queued = await pendingJobFactory.create({workspaceId});

    await cancelRunnerJobs({jobIds: [queued.jobId]});

    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});
    expect(claimed).toBeNull();
  });
});

describe('detectAndExpireStuckJobs', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  async function makeStaleJob(
    staleSeconds: number,
  ): Promise<{jobId: string; runId: string; projectId: string}> {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});
    await db()
      .update(runningJobs)
      .set({
        lastHeartbeatAt: sql`now() - (${staleSeconds} || ' seconds')::interval`,
      })
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    return {
      jobId: claimed?.jobId as string,
      runId: claimed?.runId as string,
      projectId: claimed?.projectId as string,
    };
  }

  async function runningJobsForTest() {
    return await db().select().from(runningJobs).where(eq(runningJobs.workspaceId, workspaceId));
  }

  async function outboxForJobs(jobIds: string[]) {
    const all = await db().select().from(runnersOutbox);
    return all.filter((row) => {
      // The same job ids can also have queued and claimed events from setup.
      if (row.eventType !== RUNNER_JOB_LEASE_EXPIRED) return false;
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

    await detectAndExpireStuckJobs({thresholdSeconds: 180});
    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    expect(await db().select().from(runningJobs).where(eq(runningJobs.jobId, jobId))).toHaveLength(
      0,
    );
    expect(await outboxForJobs([jobId])).toHaveLength(1);
  });

  it('sweeps an orphan pending row for the job it reaps (best-effort release may have failed)', async () => {
    const {jobId, runId, projectId} = await makeStaleJob(600);
    // A post-claim enqueue retry left a pending row whose job is already running;
    // without this sweep it would stay re-claimable for an already-finished job.
    await db()
      .insert(pendingJobs)
      .values({
        workspaceId,
        jobId,
        runId,
        projectId,
        requiredLabels: ['linux'],
      });

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    expect(await runningJobsForTest()).toHaveLength(0);
    expect(await db().select().from(pendingJobs).where(eq(pendingJobs.jobId, jobId))).toHaveLength(
      0,
    );
  });

  it('leaves the orphan pending row alone when the running row is not stale enough to reap', async () => {
    const {jobId, runId, projectId} = await makeStaleJob(60);
    await db()
      .insert(pendingJobs)
      .values({
        workspaceId,
        jobId,
        runId,
        projectId,
        requiredLabels: ['linux'],
      });

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    // The sweep is gated on actually reaping a running row, so a live job's
    // pending row is untouched.
    expect(await db().select().from(pendingJobs).where(eq(pendingJobs.jobId, jobId))).toHaveLength(
      1,
    );
  });

  it('returns the reaped {jobId, runId} per row without leaking the internal id', async () => {
    const {jobId, runId} = await makeStaleJob(600);

    const reaped = await expireStuckJobs({thresholdSeconds: 180});

    const mine = reaped.find((row) => row.jobId === jobId);
    expect(mine).toEqual({jobId, runId});
    expect(mine).not.toHaveProperty('id');
  });

  it('writes one lease_expired event per reaped job in a single bulk insert', async () => {
    const stuck1 = await makeStaleJob(600);
    const stuck2 = await makeStaleJob(600);

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    const outbox = await outboxForJobs([stuck1.jobId, stuck2.jobId]);
    expect(outbox).toHaveLength(2);
    expect(outbox.every((row) => row.eventType === RUNNER_JOB_LEASE_EXPIRED)).toBe(true);
  });

  it('two concurrent ticks reap each stuck job exactly once (no double-emit)', async () => {
    const stuck1 = await makeStaleJob(600);
    const stuck2 = await makeStaleJob(600);

    await Promise.all([
      detectAndExpireStuckJobs({thresholdSeconds: 180}),
      detectAndExpireStuckJobs({thresholdSeconds: 180}),
    ]);

    expect(await runningJobsForTest()).toHaveLength(0);
    expect(await outboxForJobs([stuck1.jobId, stuck2.jobId])).toHaveLength(2);
  });

  it('a reaper tick and a concurrent claim of the same orphan-pending job leave consistent state', async () => {
    const {jobId, runId, projectId} = await makeStaleJob(600);
    // Orphan pending row from a post-claim enqueue retry for an already-running job.
    await db()
      .insert(pendingJobs)
      .values({
        workspaceId,
        jobId,
        runId,
        projectId,
        requiredLabels: ['linux'],
      });

    // The reaper locks running-then-pending while the claim locks pending-then-running;
    // a deadlock loser rolls back, so either side may settle as rejected.
    await Promise.allSettled([
      detectAndExpireStuckJobs({thresholdSeconds: 180}),
      claimPendingJob({workspaceId, runnerSessionId, maxClaims: null}),
    ]);

    // A follow-up tick finishes any reap that lost a deadlock race.
    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    // The expired job is gone and not re-claimable; its orphan pending row is swept.
    expect(await runningJobsForTest()).toHaveLength(0);
    expect(await db().select().from(pendingJobs).where(eq(pendingJobs.jobId, jobId))).toHaveLength(
      0,
    );
    expect(await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null})).toBeNull();
  });
});

describe('getJobQueueDepth', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_ephemeral_registration_tokens, runners_pending_jobs, runners_running_jobs, runners_runner_sessions, runners_runner_tokens, runners_outbox CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('reports zero on an empty queue', async () => {
    const depth = await getJobQueueDepth();

    expect(depth).toEqual({pending: 0, running: 0});
  });

  it('counts pending and running jobs separately', async () => {
    await pendingJobFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});
    await claimPendingJob({workspaceId, runnerSessionId, maxClaims: null});

    const depth = await getJobQueueDepth();

    expect(depth).toEqual({pending: 1, running: 1});
  });
});
