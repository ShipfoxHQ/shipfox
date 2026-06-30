import {
  RUNNER_JOB_CLAIMED,
  RUNNER_JOB_LEASE_EXPIRED,
  RUNNER_JOB_QUEUED,
  type RunnersEventMap,
} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {writeOutboxEvent, writeOutboxEvents} from '@shipfox/node-outbox';
import {canonicalizeLabels} from '@shipfox/runner-labels';
import {and, arrayContained, asc, count, desc, eq, inArray, lt, sql} from 'drizzle-orm';
import {
  EmptyRequiredLabelsError,
  RunnerSessionExhaustedError,
  RunningJobExecutionNotFoundError,
} from '#core/errors.js';
import {jobExecutionEnqueuedCount, jobExecutionLeaseExpiredCount} from '#metrics/instance.js';
import type {Tx} from './db.js';
import {db} from './db.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobExecutions} from './schema/pending-job-executions.js';
import {runnerSessions} from './schema/runner-sessions.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

export interface EnqueueJobExecutionParams {
  workspaceId: string;
  jobId: string;
  executionId: string;
  runId: string;
  projectId: string;
  requiredLabels: string[];
}

// Idempotent while the job execution is still pending: a duplicate executionId already in
// `runners_pending_jobs` is a no-op. Temporal retries the enqueue activity
// at-least-once, so a unique-violation throw on a retry-after-lost-result
// would permanently fail a healthy job execution's workflow. The guard does not extend
// past the claim: once the job execution has moved to `runners_running_jobs`, a retry
// can reinsert an orphan pending row, which a later `claimPendingJobExecution` drops
// via the running-execution unique constraint (onConflictDoNothing) instead of failing.
export async function enqueueJobExecution(params: EnqueueJobExecutionParams): Promise<void> {
  const requiredLabels = [...canonicalizeLabels(params.requiredLabels)];
  if (requiredLabels.length === 0) throw new EmptyRequiredLabelsError();

  const enqueued = await db().transaction(async (tx) => {
    const [inserted] = await tx
      .insert(pendingJobExecutions)
      .values({
        workspaceId: params.workspaceId,
        jobId: params.jobId,
        executionId: params.executionId,
        runId: params.runId,
        projectId: params.projectId,
        requiredLabels,
      })
      .onConflictDoNothing({target: pendingJobExecutions.executionId})
      .returning({createdAt: pendingJobExecutions.createdAt});

    // A retry that hits the conflict inserts nothing: the first enqueue already
    // emitted the queued event (durably, in the outbox), so re-emitting would
    // only add a redundant row the subscriber coalesces away. Skip it.
    if (!inserted) return false;

    await writeOutboxEvent<RunnersEventMap>(tx, runnersOutbox, {
      type: RUNNER_JOB_QUEUED,
      payload: {
        jobId: params.jobId,
        executionId: params.executionId,
        runId: params.runId,
        queuedAt: inserted.createdAt.toISOString(),
      },
    });
    return true;
  });

  if (enqueued) jobExecutionEnqueuedCount.add(1);
}

export interface ClaimedJobExecution {
  jobId: string;
  executionId: string;
  runId: string;
  projectId: string;
}

export interface ActiveRunningJobExecution {
  jobId: string;
  executionId: string;
  runId: string;
  projectId: string;
  runnerSessionId: string;
  provisionerId: string | null;
  provisionedRunnerId: string | null;
  requiredLabels: string[];
  runnerLabels: string[];
  startedAt: Date;
  lastHeartbeatAt: Date;
}

export interface ProvisionedRunnerBoundJobExecution {
  jobId: string;
  executionId: string;
  runId: string;
  provisionedRunnerId: string;
  startedAt: Date;
  lastHeartbeatAt: Date;
  cancellationRequestedAt: Date | null;
}

export async function claimPendingJobExecution(params: {
  workspaceId: string;
  runnerSessionId: string;
  sessionLabels: string[];
  maxClaims: number | null;
}): Promise<ClaimedJobExecution | null> {
  if (params.sessionLabels.length === 0) return null;

  return await db().transaction(async (tx) => {
    let provisionerId: string | null = null;
    let provisionedRunnerId: string | null = null;

    if (params.maxClaims !== null) {
      const [session] = await tx
        .select({
          maxClaims: runnerSessions.maxClaims,
          claimsUsed: runnerSessions.claimsUsed,
          provisionerId: runnerSessions.provisionerId,
          provisionedRunnerId: runnerSessions.provisionedRunnerId,
        })
        .from(runnerSessions)
        .where(eq(runnerSessions.id, params.runnerSessionId))
        .limit(1)
        .for('update');

      if (!session || session.maxClaims === null || session.claimsUsed >= session.maxClaims) {
        throw new RunnerSessionExhaustedError(params.runnerSessionId);
      }

      // Ephemeral sessions are the only capped sessions, and the DB check keeps
      // their provisioned-runner link present as a pair.
      provisionerId = session.provisionerId;
      provisionedRunnerId = session.provisionedRunnerId;
    }

    // `id` is a uuidv7 (time-ordered), so it is a deterministic FIFO tiebreaker
    // for rows sharing a created_at within a batch.
    const [row] = await tx
      .select()
      .from(pendingJobExecutions)
      .where(
        and(
          eq(pendingJobExecutions.workspaceId, params.workspaceId),
          arrayContained(pendingJobExecutions.requiredLabels, params.sessionLabels),
        ),
      )
      .orderBy(asc(pendingJobExecutions.createdAt), asc(pendingJobExecutions.id))
      .limit(1)
      .for('update', {skipLocked: true});

    if (!row) return null;

    await tx.delete(pendingJobExecutions).where(eq(pendingJobExecutions.id, row.id));

    // An enqueue retry that lands after a prior claim can leave an orphan pending
    // row whose executionId is already in `runners_running_jobs`. Insert-or-skip
    // on the executionId unique constraint: when the execution is already running
    // the insert touches no row, so we commit the orphan's deletion and return
    // null rather than let the unique violation roll the claim back into a poison
    // loop. The runner just re-polls for a real job execution.
    const inserted = await tx
      .insert(runningJobExecutions)
      .values({
        workspaceId: row.workspaceId,
        jobId: row.jobId,
        executionId: row.executionId,
        runId: row.runId,
        projectId: row.projectId,
        runnerSessionId: params.runnerSessionId,
        provisionerId,
        provisionedRunnerId,
        requiredLabels: row.requiredLabels,
        runnerLabels: params.sessionLabels,
      })
      .onConflictDoNothing({target: runningJobExecutions.executionId})
      .returning({claimedAt: runningJobExecutions.startedAt});

    const claimed = inserted[0];
    if (!claimed) return null;

    if (params.maxClaims !== null) {
      await tx
        .update(runnerSessions)
        .set({claimsUsed: sql`${runnerSessions.claimsUsed} + 1`})
        .where(eq(runnerSessions.id, params.runnerSessionId));
    }

    // The running-row insert is the runner claiming the job execution. Emit in the same tx; the
    // payload carries the row's own claim instant so a consumer records the true time,
    // not the outbox drain time.
    await writeOutboxEvent<RunnersEventMap>(tx, runnersOutbox, {
      type: RUNNER_JOB_CLAIMED,
      payload: {
        jobId: row.jobId,
        executionId: row.executionId,
        runId: row.runId,
        claimedAt: claimed.claimedAt.toISOString(),
      },
    });

    return {
      jobId: row.jobId,
      executionId: row.executionId,
      runId: row.runId,
      projectId: row.projectId,
    };
  });
}

/**
 * Releases a job execution's lease when the orchestration workflow finalizes it: deletes the
 * running-job-execution row AND any lingering pending row for the same execution, in one tx.
 * Idempotent (0-row no-op), no token scope (the workflow is authoritative), and
 * emits no event — the workflow already owns the outcome. Sweeping the pending row
 * too closes the at-least-once window where an enqueue retry left an orphan that a
 * later claim would otherwise pick up for an already-finished job execution.
 */
export async function releaseJobExecution(params: {executionId: string}): Promise<void> {
  await db().transaction(async (tx) => {
    // Delete pending before running to match `claimPendingJobExecution`'s lock-acquisition
    // order (it locks the pending row first, then the running row). A concurrent
    // claim picking up an orphan pending row for this same job execution would otherwise
    // deadlock against the reverse order here.
    await tx
      .delete(pendingJobExecutions)
      .where(eq(pendingJobExecutions.executionId, params.executionId));
    await tx
      .delete(runningJobExecutions)
      .where(eq(runningJobExecutions.executionId, params.executionId));
  });
}

/**
 * Reaps stale leases (bounded by `limit`), emitting one
 * `runners.job.lease_expired` event per reaped job execution.
 *
 * The cutoff is re-checked in the DELETE, not just the locking subquery, so a
 * heartbeat landing mid-call spares the live row. Each reaped execution also sweeps its
 * pending row: a failed best-effort `releaseJobExecution` would otherwise leave an orphan
 * that a later claim re-runs as an already-finished job execution.
 *
 * Locks running-then-pending, the inverse of `claimPendingJobExecution` / `releaseJobExecution`.
 * That pre-existing asymmetry opens a narrow deadlock window against a concurrent
 * claim of the same orphan-pending job execution; Postgres breaks it and the cron retries.
 */
export async function expireStuckJobExecutions(params: {
  thresholdSeconds: number;
  limit?: number;
}): Promise<Array<{jobId: string; executionId: string; runId: string}>> {
  const reaped = await db().transaction(async (tx) => {
    const cutoff = sql`now() - (${params.thresholdSeconds} || ' seconds')::interval`;

    const staleIds = tx
      .select({id: runningJobExecutions.id})
      .from(runningJobExecutions)
      .where(lt(runningJobExecutions.lastHeartbeatAt, cutoff))
      .orderBy(asc(runningJobExecutions.lastHeartbeatAt))
      .limit(params.limit ?? 100)
      .for('update', {skipLocked: true});

    const deleted = await tx
      .delete(runningJobExecutions)
      .where(
        and(
          inArray(runningJobExecutions.id, staleIds),
          lt(runningJobExecutions.lastHeartbeatAt, cutoff),
        ),
      )
      .returning({
        jobId: runningJobExecutions.jobId,
        executionId: runningJobExecutions.executionId,
        runId: runningJobExecutions.runId,
      });

    if (deleted.length === 0) return [];

    await tx.delete(pendingJobExecutions).where(
      inArray(
        pendingJobExecutions.executionId,
        deleted.map((row) => row.executionId),
      ),
    );

    await writeOutboxEvents<RunnersEventMap>(
      tx,
      runnersOutbox,
      deleted.map((row) => ({
        type: RUNNER_JOB_LEASE_EXPIRED,
        payload: {jobId: row.jobId, executionId: row.executionId, runId: row.runId},
      })),
    );

    return deleted;
  });

  if (reaped.length > 0) jobExecutionLeaseExpiredCount.add(reaped.length);

  return reaped;
}

export async function getJobExecutionQueueDepth(): Promise<{
  pendingJobExecutions: number;
  runningJobExecutions: number;
}> {
  const [pending] = await db().select({value: count()}).from(pendingJobExecutions);
  const [running] = await db().select({value: count()}).from(runningJobExecutions);
  return {
    pendingJobExecutions: pending?.value ?? 0,
    runningJobExecutions: running?.value ?? 0,
  };
}

export async function listActiveRunningJobExecutions(params: {
  workspaceId: string;
  windowSeconds: number;
  limit?: number;
}): Promise<ActiveRunningJobExecution[]> {
  return await db()
    .select({
      jobId: runningJobExecutions.jobId,
      executionId: runningJobExecutions.executionId,
      runId: runningJobExecutions.runId,
      projectId: runningJobExecutions.projectId,
      runnerSessionId: runningJobExecutions.runnerSessionId,
      provisionerId: runningJobExecutions.provisionerId,
      provisionedRunnerId: runningJobExecutions.provisionedRunnerId,
      requiredLabels: runningJobExecutions.requiredLabels,
      runnerLabels: runningJobExecutions.runnerLabels,
      startedAt: runningJobExecutions.startedAt,
      lastHeartbeatAt: runningJobExecutions.lastHeartbeatAt,
    })
    .from(runningJobExecutions)
    .where(
      and(
        eq(runningJobExecutions.workspaceId, params.workspaceId),
        sql`${runningJobExecutions.lastHeartbeatAt} > now() - (${params.windowSeconds} || ' seconds')::interval`,
      ),
    )
    .orderBy(desc(runningJobExecutions.lastHeartbeatAt), desc(runningJobExecutions.id))
    .limit(params.limit ?? 1000);
}

export async function listRunningJobExecutionsByProvisionedRunnerTx(
  tx: Tx,
  params: {
    workspaceId: string;
    provisionerId: string;
    provisionedRunnerIds: string[];
  },
): Promise<ProvisionedRunnerBoundJobExecution[]> {
  if (params.provisionedRunnerIds.length === 0) return [];

  const duplicateRows = await tx
    .select({
      provisionedRunnerId: runningJobExecutions.provisionedRunnerId,
      count: count(),
    })
    .from(runningJobExecutions)
    .where(
      and(
        eq(runningJobExecutions.workspaceId, params.workspaceId),
        eq(runningJobExecutions.provisionerId, params.provisionerId),
        inArray(runningJobExecutions.provisionedRunnerId, params.provisionedRunnerIds),
      ),
    )
    .groupBy(runningJobExecutions.provisionedRunnerId)
    .having(sql`count(*) > 1`);

  const duplicateProvisionedRunnerIds = duplicateRows.flatMap((row) =>
    row.provisionedRunnerId ? [row.provisionedRunnerId] : [],
  );
  if (duplicateProvisionedRunnerIds.length > 0) {
    logger().warn(
      {
        workspaceId: params.workspaceId,
        provisionerId: params.provisionerId,
        provisionedRunnerIds: duplicateProvisionedRunnerIds,
      },
      'multiple running job executions are bound to the same provisioned runner',
    );
  }

  const result = await tx.execute<{
    jobId: string;
    executionId: string;
    runId: string;
    provisionedRunnerId: string;
    startedAt: Date | string;
    lastHeartbeatAt: Date | string;
    cancellationRequestedAt: Date | string | null;
  }>(sql`
    SELECT DISTINCT ON (${runningJobExecutions.provisionedRunnerId})
      ${runningJobExecutions.jobId} AS "jobId",
      ${runningJobExecutions.executionId} AS "executionId",
      ${runningJobExecutions.runId} AS "runId",
      ${runningJobExecutions.provisionedRunnerId} AS "provisionedRunnerId",
      ${runningJobExecutions.startedAt} AS "startedAt",
      ${runningJobExecutions.lastHeartbeatAt} AS "lastHeartbeatAt",
      ${runningJobExecutions.cancellationRequestedAt} AS "cancellationRequestedAt"
    FROM ${runningJobExecutions}
    WHERE
      ${runningJobExecutions.workspaceId} = ${params.workspaceId}
      AND ${runningJobExecutions.provisionerId} = ${params.provisionerId}
      AND ${runningJobExecutions.provisionedRunnerId} IN (${sql.join(
        params.provisionedRunnerIds.map((provisionedRunnerId) => sql`${provisionedRunnerId}`),
        sql`, `,
      )})
    ORDER BY ${runningJobExecutions.provisionedRunnerId}, ${runningJobExecutions.startedAt} DESC, ${runningJobExecutions.executionId} DESC
  `);

  return result.rows.map((row) => ({
    jobId: row.jobId,
    executionId: row.executionId,
    runId: row.runId,
    provisionedRunnerId: row.provisionedRunnerId,
    startedAt: toDate(row.startedAt),
    lastHeartbeatAt: toDate(row.lastHeartbeatAt),
    cancellationRequestedAt: row.cancellationRequestedAt
      ? toDate(row.cancellationRequestedAt)
      : null,
  }));
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export async function isJobLeaseActive(params: {
  jobId?: string;
  executionId: string;
  runnerSessionId: string;
}): Promise<boolean> {
  const [row] = await db()
    .select({id: runningJobExecutions.id})
    .from(runningJobExecutions)
    .where(
      and(
        eq(runningJobExecutions.executionId, params.executionId),
        eq(runningJobExecutions.runnerSessionId, params.runnerSessionId),
        params.jobId === undefined ? undefined : eq(runningJobExecutions.jobId, params.jobId),
      ),
    )
    .limit(1);

  return row !== undefined;
}

export async function recordHeartbeat(params: {
  executionId: string;
  runnerSessionId: string;
}): Promise<{
  cancellationRequested: boolean;
  runningJobExecution: {
    jobId: string;
    executionId: string;
    runId: string;
    projectId: string;
    workspaceId: string;
    runnerSessionId: string;
  };
}> {
  const updated = await db()
    .update(runningJobExecutions)
    .set({lastHeartbeatAt: sql`now()`})
    .where(
      and(
        eq(runningJobExecutions.executionId, params.executionId),
        eq(runningJobExecutions.runnerSessionId, params.runnerSessionId),
      ),
    )
    .returning({
      cancellationRequestedAt: runningJobExecutions.cancellationRequestedAt,
      jobId: runningJobExecutions.jobId,
      executionId: runningJobExecutions.executionId,
      runId: runningJobExecutions.runId,
      projectId: runningJobExecutions.projectId,
      workspaceId: runningJobExecutions.workspaceId,
      runnerSessionId: runningJobExecutions.runnerSessionId,
    });

  const row = updated[0];
  if (!row) throw new RunningJobExecutionNotFoundError(params.executionId);
  return {
    cancellationRequested: row.cancellationRequestedAt !== null,
    runningJobExecution: {
      jobId: row.jobId,
      executionId: row.executionId,
      runId: row.runId,
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      runnerSessionId: row.runnerSessionId,
    },
  };
}

// `COALESCE` keeps the original timestamp so concurrent or redelivered calls
// are no-ops; missing rows are silently skipped.
export async function requestJobCancellation(params: {jobId: string}): Promise<void> {
  await db()
    .update(runningJobExecutions)
    .set({
      cancellationRequestedAt: sql`COALESCE(${runningJobExecutions.cancellationRequestedAt}, now())`,
    })
    .where(eq(runningJobExecutions.jobId, params.jobId));
}

export async function cancelRunnerJobs(params: {jobIds: string[]}): Promise<void> {
  if (params.jobIds.length === 0) return;

  await db().transaction(async (tx) => {
    await tx.delete(pendingJobExecutions).where(inArray(pendingJobExecutions.jobId, params.jobIds));
    await tx
      .update(runningJobExecutions)
      .set({
        cancellationRequestedAt: sql`COALESCE(${runningJobExecutions.cancellationRequestedAt}, now())`,
      })
      .where(inArray(runningJobExecutions.jobId, params.jobIds));
  });
}
