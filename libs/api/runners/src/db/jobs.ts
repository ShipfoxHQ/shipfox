import {
  type JobPayloadDto,
  RUNNER_JOB_COMPLETED,
  type RunnersEventMap,
} from '@shipfox/api-runners-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, eq, lt, sql} from 'drizzle-orm';
import {RunningJobNotFoundError} from '#core/errors.js';
import {db} from './db.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobs} from './schema/pending-jobs.js';
import {runningJobs} from './schema/running-jobs.js';

export interface EnqueueJobParams {
  workspaceId: string;
  jobId: string;
  runId: string;
  payload: JobPayloadDto;
}

export async function enqueueJob(params: EnqueueJobParams): Promise<void> {
  await db().insert(pendingJobs).values({
    workspaceId: params.workspaceId,
    jobId: params.jobId,
    runId: params.runId,
    payload: params.payload,
  });
}

export interface ClaimedJob {
  jobId: string;
  runId: string;
  payload: JobPayloadDto;
}

export async function claimJob(params: {
  workspaceId: string;
  runnerTokenId: string;
}): Promise<ClaimedJob | null> {
  return await db().transaction(async (tx) => {
    const rows = await tx.execute(
      sql`SELECT id, workspace_id, job_id, run_id, payload
          FROM runners_pending_jobs
          WHERE workspace_id = ${params.workspaceId}
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
    );

    const row = rows.rows[0] as
      | {id: string; workspace_id: string; job_id: string; run_id: string; payload: unknown}
      | undefined;

    if (!row) return null;

    await tx.delete(pendingJobs).where(eq(pendingJobs.id, row.id));

    await tx.insert(runningJobs).values({
      workspaceId: row.workspace_id,
      jobId: row.job_id,
      runId: row.run_id,
      runnerTokenId: params.runnerTokenId,
    });

    return {
      jobId: row.job_id,
      runId: row.run_id,
      payload: row.payload as JobPayloadDto,
    };
  });
}

interface FinalizeRunningJobParams {
  jobId: string;
  /** When provided, scopes the DELETE to that runner_token (completeJob path). */
  runnerTokenId?: string;
  /** Detector path: only delete if last_heartbeat_at < now() - this many ms. */
  staleBeforeMs?: number;
  status: 'succeeded' | 'failed';
  output?: unknown;
  /** 'throw' (route paths) or 'noop' (detector paths). */
  onMissing: 'throw' | 'noop';
}

/**
 * Atomic finalize: a single DELETE...RETURNING with all guard predicates folded
 * into the WHERE clause, plus the outbox event written from the same transaction
 * only when a row was actually deleted.
 *
 * Closes codex F1 (detector race with heartbeat refresh): the staleBeforeMs cutoff
 * is re-evaluated INSIDE the DELETE, so a heartbeat that lands between the
 * iteration SELECT and the DELETE causes 0 rows affected — the live job survives.
 *
 * Closes codex F2 (loser-of-double-SELECT writing stale outbox): no SELECT before
 * DELETE, so two concurrent transactions can't both observe the row and then both
 * write outbox events from a stale run_id snapshot.
 */
async function finalizeRunningJob(
  params: FinalizeRunningJobParams,
): Promise<{runId: string} | undefined> {
  return await db().transaction(async (tx) => {
    const conditions = [eq(runningJobs.jobId, params.jobId)];
    if (params.runnerTokenId !== undefined) {
      conditions.push(eq(runningJobs.runnerTokenId, params.runnerTokenId));
    }
    if (params.staleBeforeMs !== undefined) {
      conditions.push(
        lt(
          runningJobs.lastHeartbeatAt,
          sql`now() - (${params.staleBeforeMs} || ' milliseconds')::interval`,
        ),
      );
    }

    const deleted = await tx
      .delete(runningJobs)
      .where(and(...conditions))
      .returning({runId: runningJobs.runId});

    const row = deleted[0];
    if (!row) {
      if (params.onMissing === 'throw') {
        throw new RunningJobNotFoundError(params.jobId);
      }
      return undefined;
    }

    await writeOutboxEvent<RunnersEventMap>(tx, runnersOutbox, {
      type: RUNNER_JOB_COMPLETED,
      payload: {
        jobId: params.jobId,
        runId: row.runId,
        status: params.status,
        output: params.output,
      },
    });

    return {runId: row.runId};
  });
}

export async function completeJob(
  params: {jobId: string; runnerTokenId: string},
  result: {status: 'succeeded' | 'failed'; output?: unknown},
): Promise<{runId: string}> {
  const finalized = await finalizeRunningJob({
    jobId: params.jobId,
    runnerTokenId: params.runnerTokenId,
    status: result.status,
    output: result.output,
    onMissing: 'throw',
  });
  // onMissing:'throw' guarantees a non-undefined return, but TS can't see that.
  if (!finalized) throw new RunningJobNotFoundError(params.jobId);
  return finalized;
}

/**
 * Heartbeat: refreshes last_heartbeat_at, returns whether the orchestration has
 * requested the runner cancel this job. Module-internal — only the heartbeat
 * route handler calls this.
 */
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

/**
 * Public command. Idempotent: COALESCE preserves the first cancellation timestamp,
 * so concurrent callers don't reset it. No-op when the running_jobs row is gone.
 */
export async function requestJobCancellation(params: {jobId: string}): Promise<void> {
  await db()
    .update(runningJobs)
    .set({
      cancellationRequestedAt: sql`COALESCE(${runningJobs.cancellationRequestedAt}, now())`,
    })
    .where(eq(runningJobs.jobId, params.jobId));
}

/**
 * Public command. Periodically called by the stuck-job-detector cron.
 *
 * N+1 by design (~1 SELECT + N atomic DELETEs). Acceptable for v1 runner counts;
 * revisit with bulk `DELETE ... WHERE last_heartbeat_at < $cutoff RETURNING ...`
 * + bulk outbox insert when concurrent-job scale demands it. See TODOS.md.
 */
export async function detectAndFailStuckJobs(params: {
  thresholdSeconds: number;
}): Promise<{failed: number}> {
  const candidateRows = await db()
    .select({jobId: runningJobs.jobId})
    .from(runningJobs)
    .where(
      lt(
        runningJobs.lastHeartbeatAt,
        sql`now() - (${params.thresholdSeconds} || ' seconds')::interval`,
      ),
    )
    .limit(100);

  let failed = 0;
  for (const candidate of candidateRows) {
    const finalized = await finalizeRunningJob({
      jobId: candidate.jobId,
      staleBeforeMs: params.thresholdSeconds * 1000,
      status: 'failed',
      output: {reason: 'runner_disappeared'},
      onMissing: 'noop',
    });
    if (finalized) failed += 1;
  }
  return {failed};
}
