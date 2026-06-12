import {RUNNER_JOB_LEASE_EXPIRED, type RunnersEventMap} from '@shipfox/api-runners-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, asc, eq, lt, sql} from 'drizzle-orm';
import {RunningJobNotFoundError} from '#core/errors.js';
import {db} from './db.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobs} from './schema/pending-jobs.js';
import {runningJobs} from './schema/running-jobs.js';

export interface ScheduleJobParams {
  workspaceId: string;
  jobId: string;
  runId: string;
}

// Idempotent while the job is still pending: a duplicate jobId already in
// `runners_pending_jobs` is a no-op. Temporal retries the enqueue activity
// at-least-once, so a unique-violation throw on a retry-after-lost-result
// would permanently fail a healthy job's workflow. The guard does not extend
// past the claim: once the job has moved to `runners_running_jobs`, a retry
// can reinsert an orphan pending row, which a later `claimPendingJob` drops
// via the running-job unique constraint (onConflictDoNothing) instead of failing.
export async function scheduleJob(params: ScheduleJobParams): Promise<void> {
  await db()
    .insert(pendingJobs)
    .values({
      workspaceId: params.workspaceId,
      jobId: params.jobId,
      runId: params.runId,
    })
    .onConflictDoNothing({target: pendingJobs.jobId});
}

export interface ClaimedJob {
  jobId: string;
  runId: string;
}

export async function claimPendingJob(params: {
  workspaceId: string;
  runnerTokenId: string;
}): Promise<ClaimedJob | null> {
  return await db().transaction(async (tx) => {
    // `id` is a uuidv7 (time-ordered), so it is a deterministic FIFO tiebreaker
    // for rows sharing a created_at within a batch.
    const [row] = await tx
      .select()
      .from(pendingJobs)
      .where(eq(pendingJobs.workspaceId, params.workspaceId))
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
        runnerTokenId: params.runnerTokenId,
      })
      .onConflictDoNothing({target: runningJobs.jobId})
      .returning({jobId: runningJobs.jobId});

    if (inserted.length === 0) return null;

    return {
      jobId: row.jobId,
      runId: row.runId,
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
 * Deletes a stuck running-job lease and emits `runners.job.lease_expired`.
 *
 * Race-safe by construction: the stale-heartbeat guard lives inside the DELETE's
 * WHERE and the outbox event is written in the same transaction only when a row
 * was deleted, so a heartbeat landing between an outer `findStuckJobs` read and
 * this call leaves the live job untouched, and overlapping detector runs cannot
 * double-emit. `runId` comes from `RETURNING`. Once a running row is reaped it
 * also sweeps any orphan pending row for the job (same as `releaseJob`): if the
 * workflow's best-effort `releaseJob` failed, reaping only the running row would
 * leave that orphan re-claimable for an already-finished job. Distinct from
 * `releaseJob` (the workflow-driven cleanup), which is unconditional and emits no
 * event: the two guard on different predicates, so the resemblance is shallow.
 */
export async function expireStuckJob(params: {
  jobId: string;
  staleBeforeMs: number;
}): Promise<{runId: string} | undefined> {
  return await db().transaction(async (tx) => {
    const deleted = await tx
      .delete(runningJobs)
      .where(
        and(
          eq(runningJobs.jobId, params.jobId),
          lt(
            runningJobs.lastHeartbeatAt,
            sql`now() - (${params.staleBeforeMs} || ' milliseconds')::interval`,
          ),
        ),
      )
      .returning({runId: runningJobs.runId});

    const row = deleted[0];
    if (!row) return undefined;

    await tx.delete(pendingJobs).where(eq(pendingJobs.jobId, params.jobId));

    await writeOutboxEvent<RunnersEventMap>(tx, runnersOutbox, {
      type: RUNNER_JOB_LEASE_EXPIRED,
      payload: {
        jobId: params.jobId,
        runId: row.runId,
      },
    });

    return {runId: row.runId};
  });
}

export async function recordHeartbeat(params: {
  jobId: string;
  runnerTokenId: string;
}): Promise<{cancellationRequested: boolean}> {
  const updated = await db()
    .update(runningJobs)
    .set({lastHeartbeatAt: sql`now()`})
    .where(
      and(eq(runningJobs.jobId, params.jobId), eq(runningJobs.runnerTokenId, params.runnerTokenId)),
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

// Candidate set only — callers must re-check the cutoff inside any subsequent
// DELETE so a heartbeat that lands between this read and the write is honored.
export async function findStuckJobs(params: {
  thresholdSeconds: number;
  limit?: number;
}): Promise<Array<{jobId: string}>> {
  return await db()
    .select({jobId: runningJobs.jobId})
    .from(runningJobs)
    .where(
      lt(
        runningJobs.lastHeartbeatAt,
        sql`now() - (${params.thresholdSeconds} || ' seconds')::interval`,
      ),
    )
    .limit(params.limit ?? 100);
}
