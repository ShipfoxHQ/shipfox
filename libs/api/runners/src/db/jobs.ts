import {
  RUNNER_JOB_COMPLETED,
  RUNNER_JOB_LEASE_EXPIRED,
  type RunnersEventMap,
  type StepResultDto,
} from '@shipfox/api-runners-dto';
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

// Idempotent: a duplicate jobId means the job is already scheduled. Temporal
// retries the enqueue activity at-least-once, so a unique-violation throw on a
// retry-after-lost-result would permanently fail a healthy job's workflow.
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

    await tx.insert(runningJobs).values({
      workspaceId: row.workspaceId,
      jobId: row.jobId,
      runId: row.runId,
      runnerTokenId: params.runnerTokenId,
    });

    return {
      jobId: row.jobId,
      runId: row.runId,
    };
  });
}

export interface FinalizeRunningJobParams {
  jobId: string;
  runnerTokenId: string;
  status: 'succeeded' | 'failed';
  steps: StepResultDto[];
}

/**
 * Race-safe by construction: the token-scope guard lives inside the DELETE's
 * WHERE, and the outbox event is written in the same transaction only when a
 * row was actually deleted. So two concurrent finalizers cannot both emit the
 * same `runners.job.completed` event. Throws `RunningJobNotFoundError` when no
 * row matches.
 */
export async function finalizeRunningJob(
  params: FinalizeRunningJobParams,
): Promise<{runId: string}> {
  return await db().transaction(async (tx) => {
    const deleted = await tx
      .delete(runningJobs)
      .where(
        and(
          eq(runningJobs.jobId, params.jobId),
          eq(runningJobs.runnerTokenId, params.runnerTokenId),
        ),
      )
      .returning({runId: runningJobs.runId});

    const row = deleted[0];
    if (!row) throw new RunningJobNotFoundError(params.jobId);

    await writeOutboxEvent<RunnersEventMap>(tx, runnersOutbox, {
      type: RUNNER_JOB_COMPLETED,
      payload: {
        jobId: params.jobId,
        runId: row.runId,
        status: params.status,
        steps: params.steps,
      },
    });

    return {runId: row.runId};
  });
}

/**
 * Deletes a stuck running-job lease and emits `runners.job.lease_expired`.
 *
 * Race-safe by the same contract as `finalizeRunningJob` (see above): the
 * stale-heartbeat guard lives inside the DELETE's WHERE and the outbox event is
 * written in the same transaction only when a row was deleted, so a heartbeat
 * landing between an outer `findStuckJobs` read and this call leaves the live
 * job untouched, and overlapping detector runs cannot double-emit. `runId`
 * comes from `RETURNING`. (Duplicates `finalizeRunningJob`'s shape on purpose;
 * `finalizeRunningJob` is removed in ENG-400.)
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
