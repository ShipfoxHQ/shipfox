import {
  type JobPayloadDto,
  RUNNER_JOB_COMPLETED,
  type RunnersEventMap,
  type StepResultDto,
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

export interface FinalizeRunningJobParams {
  jobId: string;
  /** When provided, only delete the row if it belongs to this runner token. */
  runnerTokenId?: string;
  /** When provided, only delete the row if its heartbeat is older than this. */
  staleBeforeMs?: number;
  status: 'succeeded' | 'failed';
  steps: StepResultDto[];
  /** Whether to throw `RunningJobNotFoundError` when no row matches the filters. */
  onMissing: 'throw' | 'noop';
}

/**
 * Race-safe by construction: all guard predicates (token scope, stale
 * heartbeat) live inside the DELETE's WHERE, and the outbox event is written
 * in the same transaction only when a row was actually deleted. So a heartbeat
 * arriving between an outer "is this stuck?" check and this call cannot cause
 * a live job to be finalized, and two concurrent finalizers cannot both emit
 * the same `runners.job.completed` event.
 */
export async function finalizeRunningJob(
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
        steps: params.steps,
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
