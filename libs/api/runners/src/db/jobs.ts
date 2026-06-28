import {
  canonicalizeRunnerLabels,
  RUNNER_JOB_CLAIMED,
  RUNNER_JOB_LEASE_EXPIRED,
  RUNNER_JOB_QUEUED,
  type RunnersEventMap,
} from '@shipfox/api-runners-dto';
import {writeOutboxEvent, writeOutboxEvents} from '@shipfox/node-outbox';
import {and, arrayContained, asc, count, desc, eq, inArray, lt, sql} from 'drizzle-orm';
import {
  EmptyRequiredLabelsError,
  RunnerSessionExhaustedError,
  RunningJobNotFoundError,
} from '#core/errors.js';
import {jobEnqueuedCount, jobLeaseExpiredCount} from '#metrics/instance.js';
import {db} from './db.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobs} from './schema/pending-jobs.js';
import {runnerSessions} from './schema/runner-sessions.js';
import {runningJobs} from './schema/running-jobs.js';

export interface EnqueueJobParams {
  workspaceId: string;
  jobId: string;
  runId: string;
  projectId: string;
  requiredLabels: string[];
}

// Idempotent while the job is still pending: a duplicate jobId already in
// `runners_pending_jobs` is a no-op. Temporal retries the enqueue activity
// at-least-once, so a unique-violation throw on a retry-after-lost-result
// would permanently fail a healthy job's workflow. The guard does not extend
// past the claim: once the job has moved to `runners_running_jobs`, a retry
// can reinsert an orphan pending row, which a later `claimPendingJob` drops
// via the running-job unique constraint (onConflictDoNothing) instead of failing.
export async function enqueueJob(params: EnqueueJobParams): Promise<void> {
  const requiredLabels = canonicalizeRunnerLabels(params.requiredLabels);
  if (requiredLabels.length === 0) throw new EmptyRequiredLabelsError();

  const enqueued = await db().transaction(async (tx) => {
    const [inserted] = await tx
      .insert(pendingJobs)
      .values({
        workspaceId: params.workspaceId,
        jobId: params.jobId,
        runId: params.runId,
        projectId: params.projectId,
        requiredLabels,
      })
      .onConflictDoNothing({target: pendingJobs.jobId})
      .returning({createdAt: pendingJobs.createdAt});

    // A retry that hits the conflict inserts nothing: the first enqueue already
    // emitted the queued event (durably, in the outbox), so re-emitting would
    // only add a redundant row the subscriber coalesces away. Skip it.
    if (!inserted) return false;

    await writeOutboxEvent<RunnersEventMap>(tx, runnersOutbox, {
      type: RUNNER_JOB_QUEUED,
      payload: {
        jobId: params.jobId,
        runId: params.runId,
        queuedAt: inserted.createdAt.toISOString(),
      },
    });
    return true;
  });

  if (enqueued) jobEnqueuedCount.add(1);
}

export interface ClaimedJob {
  jobId: string;
  runId: string;
  projectId: string;
}

export interface ActiveRunningJob {
  jobId: string;
  runId: string;
  projectId: string;
  runnerSessionId: string;
  requiredLabels: string[];
  runnerLabels: string[];
  startedAt: Date;
  lastHeartbeatAt: Date;
}

export async function claimPendingJob(params: {
  workspaceId: string;
  runnerSessionId: string;
  sessionLabels: string[];
  maxClaims: number | null;
}): Promise<ClaimedJob | null> {
  if (params.sessionLabels.length === 0) return null;

  return await db().transaction(async (tx) => {
    if (params.maxClaims !== null) {
      const [session] = await tx
        .select({
          maxClaims: runnerSessions.maxClaims,
          claimsUsed: runnerSessions.claimsUsed,
        })
        .from(runnerSessions)
        .where(eq(runnerSessions.id, params.runnerSessionId))
        .limit(1)
        .for('update');

      if (!session || session.maxClaims === null || session.claimsUsed >= session.maxClaims) {
        throw new RunnerSessionExhaustedError(params.runnerSessionId);
      }
    }

    // `id` is a uuidv7 (time-ordered), so it is a deterministic FIFO tiebreaker
    // for rows sharing a created_at within a batch.
    const [row] = await tx
      .select()
      .from(pendingJobs)
      .where(
        and(
          eq(pendingJobs.workspaceId, params.workspaceId),
          arrayContained(pendingJobs.requiredLabels, params.sessionLabels),
        ),
      )
      .orderBy(asc(pendingJobs.createdAt), asc(pendingJobs.id))
      .limit(1)
      .for('update', {skipLocked: true});

    if (!row) return null;

    await tx.delete(pendingJobs).where(eq(pendingJobs.id, row.id));

    // An enqueue retry that lands after a prior claim can leave an orphan pending
    // row whose jobId is already in `runners_running_jobs`. Insert-or-skip on the
    // jobId unique constraint: when the job is already running the insert touches
    // no row, so we commit the orphan's deletion (cleaning the queue) and return
    // null rather than let the unique violation roll the whole claim back into a
    // poison loop. The runner just re-polls for a real job.
    const inserted = await tx
      .insert(runningJobs)
      .values({
        workspaceId: row.workspaceId,
        jobId: row.jobId,
        runId: row.runId,
        projectId: row.projectId,
        runnerSessionId: params.runnerSessionId,
        requiredLabels: row.requiredLabels,
        runnerLabels: params.sessionLabels,
      })
      .onConflictDoNothing({target: runningJobs.jobId})
      .returning({claimedAt: runningJobs.startedAt});

    const claimed = inserted[0];
    if (!claimed) return null;

    if (params.maxClaims !== null) {
      await tx
        .update(runnerSessions)
        .set({claimsUsed: sql`${runnerSessions.claimsUsed} + 1`})
        .where(eq(runnerSessions.id, params.runnerSessionId));
    }

    // The running-row insert is the runner claiming the job. Emit in the same tx; the
    // payload carries the row's own claim instant so a consumer records the true time,
    // not the outbox drain time.
    await writeOutboxEvent<RunnersEventMap>(tx, runnersOutbox, {
      type: RUNNER_JOB_CLAIMED,
      payload: {
        jobId: row.jobId,
        runId: row.runId,
        claimedAt: claimed.claimedAt.toISOString(),
      },
    });

    return {
      jobId: row.jobId,
      runId: row.runId,
      projectId: row.projectId,
    };
  });
}

/**
 * Releases a job's lease when the orchestration workflow finalizes it: deletes the
 * running-job row AND any lingering pending row for the same job, in one tx.
 * Idempotent (0-row no-op), no token scope (the workflow is authoritative), and
 * emits no event — the workflow already owns the outcome. Sweeping the pending row
 * too closes the at-least-once window where an enqueue retry left an orphan that a
 * later claim would otherwise pick up for an already-finished job.
 */
export async function releaseJob(params: {jobId: string}): Promise<void> {
  await db().transaction(async (tx) => {
    // Delete pending before running to match `claimPendingJob`'s lock-acquisition
    // order (it locks the pending row first, then the running row). A concurrent
    // claim picking up an orphan pending row for this same job would otherwise
    // deadlock against the reverse order here.
    await tx.delete(pendingJobs).where(eq(pendingJobs.jobId, params.jobId));
    await tx.delete(runningJobs).where(eq(runningJobs.jobId, params.jobId));
  });
}

/**
 * Reaps stale leases (bounded by `limit`), emitting one
 * `runners.job.lease_expired` event per reaped job.
 *
 * The cutoff is re-checked in the DELETE, not just the locking subquery, so a
 * heartbeat landing mid-call spares the live row. Each reaped job also sweeps its
 * pending row: a failed best-effort `releaseJob` would otherwise leave an orphan
 * that a later claim re-runs as an already-finished job.
 *
 * Locks running-then-pending, the inverse of `claimPendingJob` / `releaseJob`.
 * That pre-existing asymmetry opens a narrow deadlock window against a concurrent
 * claim of the same orphan-pending job; Postgres breaks it and the cron retries.
 */
export async function expireStuckJobs(params: {
  thresholdSeconds: number;
  limit?: number;
}): Promise<Array<{jobId: string; runId: string}>> {
  const reaped = await db().transaction(async (tx) => {
    const cutoff = sql`now() - (${params.thresholdSeconds} || ' seconds')::interval`;

    const staleIds = tx
      .select({id: runningJobs.id})
      .from(runningJobs)
      .where(lt(runningJobs.lastHeartbeatAt, cutoff))
      .orderBy(asc(runningJobs.lastHeartbeatAt))
      .limit(params.limit ?? 100)
      .for('update', {skipLocked: true});

    const deleted = await tx
      .delete(runningJobs)
      .where(and(inArray(runningJobs.id, staleIds), lt(runningJobs.lastHeartbeatAt, cutoff)))
      .returning({jobId: runningJobs.jobId, runId: runningJobs.runId});

    if (deleted.length === 0) return [];

    await tx.delete(pendingJobs).where(
      inArray(
        pendingJobs.jobId,
        deleted.map((row) => row.jobId),
      ),
    );

    await writeOutboxEvents<RunnersEventMap>(
      tx,
      runnersOutbox,
      deleted.map((row) => ({
        type: RUNNER_JOB_LEASE_EXPIRED,
        payload: {jobId: row.jobId, runId: row.runId},
      })),
    );

    return deleted;
  });

  if (reaped.length > 0) jobLeaseExpiredCount.add(reaped.length);

  return reaped;
}

export async function getJobQueueDepth(): Promise<{pending: number; running: number}> {
  const [pending] = await db().select({value: count()}).from(pendingJobs);
  const [running] = await db().select({value: count()}).from(runningJobs);
  return {pending: pending?.value ?? 0, running: running?.value ?? 0};
}

export async function listActiveRunningJobs(params: {
  workspaceId: string;
  windowSeconds: number;
  limit?: number;
}): Promise<ActiveRunningJob[]> {
  return await db()
    .select({
      jobId: runningJobs.jobId,
      runId: runningJobs.runId,
      projectId: runningJobs.projectId,
      runnerSessionId: runningJobs.runnerSessionId,
      requiredLabels: runningJobs.requiredLabels,
      runnerLabels: runningJobs.runnerLabels,
      startedAt: runningJobs.startedAt,
      lastHeartbeatAt: runningJobs.lastHeartbeatAt,
    })
    .from(runningJobs)
    .where(
      and(
        eq(runningJobs.workspaceId, params.workspaceId),
        sql`${runningJobs.lastHeartbeatAt} > now() - (${params.windowSeconds} || ' seconds')::interval`,
      ),
    )
    .orderBy(desc(runningJobs.lastHeartbeatAt), desc(runningJobs.id))
    .limit(params.limit ?? 1000);
}

export async function recordHeartbeat(params: {
  jobId: string;
  runnerSessionId: string;
}): Promise<{cancellationRequested: boolean}> {
  const updated = await db()
    .update(runningJobs)
    .set({lastHeartbeatAt: sql`now()`})
    .where(
      and(
        eq(runningJobs.jobId, params.jobId),
        eq(runningJobs.runnerSessionId, params.runnerSessionId),
      ),
    )
    .returning({cancellationRequestedAt: runningJobs.cancellationRequestedAt});

  const row = updated[0];
  if (!row) throw new RunningJobNotFoundError(params.jobId);
  return {cancellationRequested: row.cancellationRequestedAt !== null};
}

// `COALESCE` keeps the original timestamp so concurrent or redelivered calls
// are no-ops; missing rows are silently skipped.
export async function requestJobCancellation(params: {jobId: string}): Promise<void> {
  await db()
    .update(runningJobs)
    .set({
      cancellationRequestedAt: sql`COALESCE(${runningJobs.cancellationRequestedAt}, now())`,
    })
    .where(eq(runningJobs.jobId, params.jobId));
}

export async function cancelRunnerJobs(params: {jobIds: string[]}): Promise<void> {
  if (params.jobIds.length === 0) return;

  await db().transaction(async (tx) => {
    await tx.delete(pendingJobs).where(inArray(pendingJobs.jobId, params.jobIds));
    await tx
      .update(runningJobs)
      .set({
        cancellationRequestedAt: sql`COALESCE(${runningJobs.cancellationRequestedAt}, now())`,
      })
      .where(inArray(runningJobs.jobId, params.jobIds));
  });
}
