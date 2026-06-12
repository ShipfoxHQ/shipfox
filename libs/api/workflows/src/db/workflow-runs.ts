import type {WorkflowModel} from '@shipfox/api-definitions';
import {
  WORKFLOW_RUN_CREATED,
  WORKFLOWS_JOB_COMPLETED,
  WORKFLOWS_JOB_TIMED_OUT,
  WORKFLOWS_STEP_RESTART_ENQUEUED,
  type WorkflowsEventMap,
} from '@shipfox/api-workflows-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, asc, count, desc, eq, gte, inArray, lt, lte, or, type SQL, sql} from 'drizzle-orm';
import type {Job, JobStatus} from '#core/entities/job.js';
import type {RuntimeCompletionStatus} from '#core/entities/runtime-dag.js';
import type {Step, StepAttempt, StepAttemptStatus, StepStatus} from '#core/entities/step.js';
import type {TriggerPayload, WorkflowRun, WorkflowRunStatus} from '#core/entities/workflow-run.js';
import {deriveCompletion, isTerminal} from '#core/step-transition/decide-step-transition.js';
import {materializeWorkflowModel} from '#core/workflow-runtime/index.js';
import {db, type Tx} from './db.js';
import {jobs, toJob} from './schema/jobs.js';
import {workflowsOutbox} from './schema/outbox.js';
import {stepAttempts, toStepAttempt} from './schema/step-attempts.js';
import {steps, toStep} from './schema/steps.js';
import {toWorkflowRun, workflowRuns} from './schema/workflow-runs.js';

export interface CreateWorkflowRunParams {
  workspaceId: string;
  projectId: string;
  definitionId: string;
  name?: string | undefined;
  model: WorkflowModel;
  triggerPayload: TriggerPayload;
  inputs?: Record<string, unknown> | undefined;
  triggerIdempotencyKey?: string | undefined;
}

export async function createWorkflowRun(params: CreateWorkflowRunParams): Promise<WorkflowRun> {
  const materializedJobs = materializeWorkflowModel(params.model);

  return await db().transaction(async (tx) => {
    const insertResult = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        definitionId: params.definitionId,
        name: params.name ?? params.model.name,
        status: 'pending',
        triggerSource: params.triggerPayload.source,
        triggerEvent: params.triggerPayload.event,
        triggerPayload: params.triggerPayload,
        inputs: params.inputs ?? null,
        triggerIdempotencyKey: params.triggerIdempotencyKey ?? null,
      })
      .onConflictDoNothing({target: workflowRuns.triggerIdempotencyKey})
      .returning();

    const runRow = insertResult[0];
    if (!runRow) {
      // Conflict path: skip jobs/steps/outbox so the first insert keeps ownership of side effects.
      if (!params.triggerIdempotencyKey) {
        throw new Error('Insert returned no rows');
      }
      const existing = await tx
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.triggerIdempotencyKey, params.triggerIdempotencyKey))
        .limit(1);
      const existingRow = existing[0];
      if (!existingRow) {
        throw new Error(
          `Idempotency conflict but existing run missing for key ${params.triggerIdempotencyKey}`,
        );
      }
      return toWorkflowRun(existingRow);
    }

    let jobRows: (typeof jobs.$inferSelect)[] = [];

    if (materializedJobs.length > 0) {
      jobRows = await tx
        .insert(jobs)
        .values(
          materializedJobs.map((job) => ({
            runId: runRow.id,
            name: job.sourceName,
            status: 'pending' as const,
            dependencies: [...job.dependencies],
            runner: job.runner.length === 0 ? null : [...job.runner],
            position: job.position,
          })),
        )
        .returning();
    }

    const stepValues: (typeof steps.$inferInsert)[] = [];
    for (const [jobIndex, jobRow] of jobRows.entries()) {
      const job = materializedJobs[jobIndex];
      if (!job) continue;
      for (const step of job.steps) {
        stepValues.push({
          jobId: jobRow.id,
          name: step.sourceName,
          status: step.status,
          type: step.type,
          config: step.config,
          position: step.position,
        });
      }
    }

    if (stepValues.length > 0) {
      await tx.insert(steps).values(stepValues);
    }

    await writeOutboxEvent<WorkflowsEventMap>(tx, workflowsOutbox, {
      type: WORKFLOW_RUN_CREATED,
      payload: {
        runId: runRow.id,
        workspaceId: runRow.workspaceId,
        projectId: runRow.projectId,
        definitionId: runRow.definitionId,
      },
    });

    return toWorkflowRun(runRow);
  });
}

export async function getWorkflowRunById(id: string): Promise<WorkflowRun | undefined> {
  const rows = await db().select().from(workflowRuns).where(eq(workflowRuns.id, id)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toWorkflowRun(row);
}

export interface WorkflowRunCursor {
  createdAt: Date;
  id: string;
}

export interface WorkflowRunFilters {
  status?: WorkflowRunStatus | undefined;
  definitionId?: string | undefined;
  triggerSource?: string | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
}

export interface ListWorkflowRunsParams {
  projectId: string;
  limit: number;
  cursor?: WorkflowRunCursor | undefined;
  filters?: WorkflowRunFilters | undefined;
  includeTotal?: boolean | undefined;
}

export interface ListWorkflowRunsResult {
  runs: WorkflowRun[];
  nextCursor: WorkflowRunCursor | null;
  filteredTotalCount: number | null;
}

function cursorWhere(cursor: WorkflowRunCursor | undefined): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    lt(workflowRuns.createdAt, cursor.createdAt),
    and(eq(workflowRuns.createdAt, cursor.createdAt), lt(workflowRuns.id, cursor.id)),
  );
}

export function buildWorkflowRunListConditions(params: {
  projectId: string;
  filters?: WorkflowRunFilters | undefined;
  cursor?: WorkflowRunCursor | undefined;
  omit?: 'status' | 'definitionId' | 'triggerSource' | undefined;
}): SQL[] {
  const filters = params.filters;
  const conditions: SQL[] = [eq(workflowRuns.projectId, params.projectId)];
  const cursorCondition = cursorWhere(params.cursor);
  if (cursorCondition) conditions.push(cursorCondition);
  if (filters?.status && params.omit !== 'status') {
    conditions.push(eq(workflowRuns.status, filters.status));
  }
  if (filters?.definitionId && params.omit !== 'definitionId') {
    conditions.push(eq(workflowRuns.definitionId, filters.definitionId));
  }
  if (filters?.triggerSource && params.omit !== 'triggerSource') {
    conditions.push(eq(workflowRuns.triggerSource, filters.triggerSource));
  }
  if (filters?.createdFrom) {
    conditions.push(gte(workflowRuns.createdAt, filters.createdFrom));
  }
  if (filters?.createdTo) {
    conditions.push(lte(workflowRuns.createdAt, filters.createdTo));
  }
  return conditions;
}

export async function listWorkflowRuns(
  params: ListWorkflowRunsParams,
): Promise<ListWorkflowRunsResult> {
  const conditions = buildWorkflowRunListConditions(params);
  const rows = await db()
    .select()
    .from(workflowRuns)
    .where(and(...conditions))
    .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.id))
    .limit(params.limit + 1);

  let totalCount: number | null = null;
  if (params.includeTotal) {
    const [{value} = {value: 0}] = await db()
      .select({value: count()})
      .from(workflowRuns)
      .where(
        and(
          ...buildWorkflowRunListConditions({projectId: params.projectId, filters: params.filters}),
        ),
      );
    totalCount = value;
  }

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);

  return {
    runs: pageRows.map(toWorkflowRun),
    nextCursor: hasMore && last ? {createdAt: last.createdAt, id: last.id} : null,
    filteredTotalCount: totalCount,
  };
}

export async function listWorkflowRunsByProject(projectId: string): Promise<WorkflowRun[]> {
  const result = await listWorkflowRuns({projectId, limit: 100});
  return result.runs;
}

export interface WorkflowRunAggregates {
  status: Array<{value: WorkflowRunStatus; count: number}>;
  triggerSource: Array<{value: string; count: number}>;
  workflow: Array<{value: string; count: number}>;
}

export async function getWorkflowRunAggregates(params: {
  projectId: string;
  filters?: WorkflowRunFilters | undefined;
}): Promise<WorkflowRunAggregates> {
  const [statusRows, triggerRows, workflowRows] = await Promise.all([
    db()
      .select({value: workflowRuns.status, count: count()})
      .from(workflowRuns)
      .where(
        and(
          ...buildWorkflowRunListConditions({
            projectId: params.projectId,
            filters: params.filters,
            omit: 'status',
          }),
        ),
      )
      .groupBy(workflowRuns.status),
    db()
      .select({value: workflowRuns.triggerSource, count: count()})
      .from(workflowRuns)
      .where(
        and(
          ...buildWorkflowRunListConditions({
            projectId: params.projectId,
            filters: params.filters,
            omit: 'triggerSource',
          }),
        ),
      )
      .groupBy(workflowRuns.triggerSource),
    db()
      .select({value: workflowRuns.definitionId, count: count()})
      .from(workflowRuns)
      .where(
        and(
          ...buildWorkflowRunListConditions({
            projectId: params.projectId,
            filters: params.filters,
            omit: 'definitionId',
          }),
        ),
      )
      .groupBy(workflowRuns.definitionId),
  ]);

  return {
    status: statusRows,
    triggerSource: triggerRows,
    workflow: workflowRows,
  };
}

export async function getJobsByRunId(runId: string): Promise<Job[]> {
  const rows = await db()
    .select()
    .from(jobs)
    .where(eq(jobs.runId, runId))
    .orderBy(asc(jobs.position));
  return rows.map(toJob);
}

export async function getStepsByJobId(jobId: string): Promise<Step[]> {
  const rows = await db()
    .select()
    .from(steps)
    .where(eq(steps.jobId, jobId))
    .orderBy(asc(steps.position));
  return rows.map(toStep);
}

export async function getStepsByJobIds(jobIds: string[]): Promise<Step[]> {
  if (jobIds.length === 0) return [];
  const rows = await db()
    .select()
    .from(steps)
    .where(inArray(steps.jobId, jobIds))
    .orderBy(asc(steps.position));
  return rows.map(toStep);
}

export interface UpdateWorkflowRunStatusParams {
  runId: string;
  status: WorkflowRunStatus;
  expectedVersion: number;
}

export async function updateWorkflowRunStatus(
  params: UpdateWorkflowRunStatusParams,
): Promise<WorkflowRun> {
  const rows = await db()
    .update(workflowRuns)
    .set({
      status: params.status,
      version: sql`${workflowRuns.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(workflowRuns.id, params.runId), eq(workflowRuns.version, params.expectedVersion)))
    .returning();

  const row = rows[0];
  if (!row)
    throw new Error(
      `Optimistic lock failure: run ${params.runId} version ${params.expectedVersion}`,
    );
  return toWorkflowRun(row);
}

export interface UpdateJobStatusAtVersionParams {
  jobId: string;
  status: JobStatus;
  expectedVersion: number;
  markTimedOut?: boolean;
}

// Returns null on version mismatch so callers can choose throw vs treat-as-success.
async function updateJobStatusAtVersion(
  tx: Tx,
  params: UpdateJobStatusAtVersionParams,
): Promise<Job | null> {
  const rows = await tx
    .update(jobs)
    .set({
      status: params.status,
      version: sql`${jobs.version} + 1`,
      updatedAt: new Date(),
      ...(params.markTimedOut ? {timedOutAt: new Date()} : {}),
    })
    .where(and(eq(jobs.id, params.jobId), eq(jobs.version, params.expectedVersion)))
    .returning();

  const row = rows[0];
  if (!row) return null;
  return toJob(row);
}

export interface UpdateJobStatusParams {
  jobId: string;
  status: JobStatus;
  expectedVersion: number;
}

export async function updateJobStatus(params: UpdateJobStatusParams): Promise<Job> {
  return await db().transaction(async (tx) => {
    const updated = await updateJobStatusAtVersion(tx, {
      jobId: params.jobId,
      status: params.status,
      expectedVersion: params.expectedVersion,
    });
    if (updated) return updated;

    // Idempotent under Temporal activity retry: a lost result after a committed
    // status update leaves the row at version+1, so the retried call's
    // expected-version UPDATE matches 0 rows. If the row is already in the
    // requested status, the prior attempt of this same transition won — return it
    // instead of throwing an optimistic-lock error that would wedge the workflow.
    const existing = await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1);
    const row = existing[0];
    if (row && row.status === params.status) return toJob(row);
    throw new Error(
      `Optimistic lock failure: job ${params.jobId} version ${params.expectedVersion}`,
    );
  });
}

export interface FailJobAsTimedOutParams {
  jobId: string;
  runId: string;
  expectedVersion: number;
}

// Idempotent under retry: a 0-row UPDATE re-reads the row, and a non-null
// `timed_out_at` proves an earlier attempt of this same activity already
// finalized — return its version without writing a second outbox event.
export async function failJobAsTimedOut(params: FailJobAsTimedOutParams): Promise<Job> {
  return await db().transaction(async (tx) => {
    const updated = await updateJobStatusAtVersion(tx, {
      jobId: params.jobId,
      status: 'failed',
      expectedVersion: params.expectedVersion,
      markTimedOut: true,
    });

    if (!updated) {
      const existing = await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1);
      const row = existing[0];
      if (row && row.timedOutAt !== null) {
        return toJob(row);
      }
      throw new Error(
        `Optimistic lock failure: job ${params.jobId} version ${params.expectedVersion}`,
      );
    }

    await writeOutboxEvent<WorkflowsEventMap>(tx, workflowsOutbox, {
      type: WORKFLOWS_JOB_TIMED_OUT,
      payload: {jobId: params.jobId, runId: params.runId},
    });

    return updated;
  });
}

/**
 * Resolves a job whose runner lease expired, in a SINGLE transaction so a
 * concurrent `recordStepResult` cannot interleave between the terminal check and
 * the writes. Server state is the final gate:
 *
 *   getStepsByJobIdForUpdate (FOR UPDATE, position order — same lock order as
 *   recordStepResult, so the two never deadlock)
 *        │
 *        ├─ all steps terminal ─► the job finished concurrently (e.g. a lagging
 *        │                        WORKFLOWS_JOB_COMPLETED). Adopt deriveCompletion.
 *        └─ otherwise ──────────► the runner died mid-job: fail it + cancel the
 *                                 remaining (non-terminal) steps.
 *
 * Returns the job's ACTUAL persisted terminal status (+version) by re-reading the
 * row, never a hardcoded 'failed' — so a row a concurrent DAG-cancel already
 * terminalised (the guarded UPDATE then matches 0 rows) is reported truthfully.
 * A non-`succeeded` terminal status maps to `failed` for the run-orchestration DAG.
 */
export async function resolveJobAfterLeaseExpiry(params: {
  jobId: string;
  expectedVersion: number;
}): Promise<{status: RuntimeCompletionStatus; jobVersion: number}> {
  return await db().transaction(async (tx) => {
    const jobSteps = await getStepsByJobIdForUpdate(params.jobId, tx);

    // A job with no steps is malformed, not a runner-died-mid-job failure. Surface
    // it loudly instead of silently marking the job failed and hiding the bad state.
    if (jobSteps.length === 0) {
      throw new Error(`Job has no steps resolving lease expiry: ${params.jobId}`);
    }

    if (jobSteps.every((step) => isTerminal(step.status))) {
      await updateJobStatusAtVersion(tx, {
        jobId: params.jobId,
        status: deriveCompletion(jobSteps),
        expectedVersion: params.expectedVersion,
      });
    } else {
      await updateJobStatusAtVersion(tx, {
        jobId: params.jobId,
        status: 'failed',
        expectedVersion: params.expectedVersion,
      });
      await bulkUpdateStepStatuses({jobId: params.jobId, status: 'cancelled'}, tx);
    }

    const row = (await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1))[0];
    if (!row) throw new Error(`Job not found resolving lease expiry: ${params.jobId}`);
    const status: RuntimeCompletionStatus = row.status === 'succeeded' ? 'succeeded' : 'failed';
    return {status, jobVersion: row.version};
  });
}

// Enqueue the terminal-completion signal in the SAME transaction as the final
// per-step result that made the job terminal. Mirrors failJobAsTimedOut: the
// state change and its signal intent commit together, so per-step execution
// observes job completion exactly once (the outbox is at-least-once; the job
// workflow dedupes the signal).
export async function writeJobCompletedOutbox(
  tx: Tx,
  params: {jobId: string; status: 'succeeded' | 'failed'},
): Promise<void> {
  const rows = await tx
    .select({runId: jobs.runId})
    .from(jobs)
    .where(eq(jobs.id, params.jobId))
    .limit(1);
  const runId = rows[0]?.runId;
  if (!runId) {
    throw new Error(`Cannot enqueue job-completed event: job ${params.jobId} not found`);
  }

  await writeOutboxEvent<WorkflowsEventMap>(tx, workflowsOutbox, {
    type: WORKFLOWS_JOB_COMPLETED,
    payload: {jobId: params.jobId, runId, status: params.status},
  });
}

export interface BulkUpdateStepStatusesParams {
  jobId: string;
  status: StepStatus;
}

export async function bulkUpdateStepStatuses(
  params: BulkUpdateStepStatusesParams,
  tx?: Tx,
): Promise<void> {
  const executor = tx ?? db();
  await executor
    .update(steps)
    .set({
      status: params.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(steps.jobId, params.jobId),
        sql`${steps.status} NOT IN ('succeeded','failed','cancelled')`,
      ),
    );

  // Finalize any open attempt rows for the steps just terminalized, so a
  // dispatched-then-timed-out/cancelled step never leaves a `running` audit row
  // stranded (it would otherwise read as phantom in-flight work to gate/restart
  // logic). The just-failed step on the normal report path is already terminal,
  // so this only catches the bulk timeout/cancel sweeps.
  // Only ever called with a terminal sweep status (cancelled on the failed-sibling
  // path, failed on timeout).
  if (params.status === 'failed' || params.status === 'cancelled') {
    await executor
      .update(stepAttempts)
      .set({status: params.status, finishedAt: new Date()})
      .where(and(eq(stepAttempts.jobId, params.jobId), eq(stepAttempts.status, 'running')));
  }
}

// Per-step progression primitives. They take a mandatory `tx` because they only
// run inside the job-execution service's transaction, and every write guards on
// the never-downgrade predicate so a late or duplicate write cannot overwrite an
// already-terminal row.

// Locking in position order gives both entry points one lock order, so they
// never deadlock and the failed-report apply+cancel pair commits atomically.
export async function getStepsByJobIdForUpdate(jobId: string, tx: Tx): Promise<Step[]> {
  const rows = await tx
    .select()
    .from(steps)
    .where(eq(steps.jobId, jobId))
    .orderBy(asc(steps.position))
    .for('update');
  return rows.map(toStep);
}

export interface MarkStepRunningParams {
  jobId: string;
  stepId: string;
}

export async function markStepRunning(params: MarkStepRunningParams, tx: Tx): Promise<Step | null> {
  const rows = await tx
    .update(steps)
    .set({status: 'running', updatedAt: new Date()})
    .where(
      and(
        eq(steps.id, params.stepId),
        eq(steps.jobId, params.jobId),
        sql`${steps.status} NOT IN ('succeeded','failed','cancelled')`,
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) return null;
  const step = toStep(row);
  // Open the attempt this dispatch runs. onConflictDoNothing makes a racing
  // re-dispatch a no-op against the unique (step_id, attempt) anchor; normal
  // re-delivery returns the already-running step without calling this.
  await insertRunningStepAttempt(
    {jobId: step.jobId, stepId: step.id, attempt: step.currentAttempt},
    tx,
  );
  return step;
}

export interface InsertRunningStepAttemptParams {
  jobId: string;
  stepId: string;
  attempt: number;
}

export async function insertRunningStepAttempt(
  params: InsertRunningStepAttemptParams,
  tx: Tx,
): Promise<void> {
  await tx
    .insert(stepAttempts)
    .values({
      jobId: params.jobId,
      stepId: params.stepId,
      attempt: params.attempt,
      status: 'running',
    })
    .onConflictDoNothing({target: [stepAttempts.stepId, stepAttempts.attempt]});
}

export interface FinishStepAttemptParams {
  stepId: string;
  attempt: number;
  status: Exclude<StepAttemptStatus, 'running'>;
  error?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  exitCode?: number | null;
  gateResult?: Record<string, unknown> | null;
  restartReason?: string | null;
}

// Finalize the running attempt to a terminal state. The `status='running'` guard
// makes this idempotent: a duplicate report finds the attempt already terminal
// and updates nothing (never-downgrade for the audit row).
export async function finishStepAttempt(params: FinishStepAttemptParams, tx: Tx): Promise<void> {
  await tx
    .update(stepAttempts)
    .set({
      status: params.status,
      output: params.output ?? null,
      error: params.error ?? null,
      exitCode: params.exitCode ?? null,
      gateResult: params.gateResult ?? null,
      restartReason: params.restartReason ?? null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(stepAttempts.stepId, params.stepId),
        eq(stepAttempts.attempt, params.attempt),
        eq(stepAttempts.status, 'running'),
      ),
    );
}

export interface RewindStepsToPendingParams {
  jobId: string;
  fromPosition: number;
}

// Restart-only: rewind every step at or after `fromPosition` back to pending,
// clearing its result and bumping both `version` and `current_attempt` so the next
// dispatch opens a fresh attempt. This DELIBERATELY bypasses the never-downgrade
// guard used everywhere else — it is the one place that resurrects terminal steps
// — so it must only be called from the durable-restart path, never the ordinary
// report path. It must run in the same transaction as the failed-attempt write.
export async function rewindStepsToPending(
  params: RewindStepsToPendingParams,
  tx: Tx,
): Promise<void> {
  await tx
    .update(steps)
    .set({
      status: 'pending',
      output: null,
      error: null,
      version: sql`${steps.version} + 1`,
      currentAttempt: sql`${steps.currentAttempt} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(steps.jobId, params.jobId), gte(steps.position, params.fromPosition)));
}

// Enqueue the durable audit record of a restart, in the same transaction as the
// rewind. Looks up the run id like writeJobCompletedOutbox.
export async function writeStepRestartEnqueuedOutbox(
  tx: Tx,
  params: {
    jobId: string;
    failedStepId: string;
    failedStepAttempt: number;
    restartFromStepId: string;
    reason: string;
  },
): Promise<void> {
  const rows = await tx
    .select({runId: jobs.runId})
    .from(jobs)
    .where(eq(jobs.id, params.jobId))
    .limit(1);
  const runId = rows[0]?.runId;
  if (!runId) {
    throw new Error(`Cannot enqueue step-restart event: job ${params.jobId} not found`);
  }

  await writeOutboxEvent<WorkflowsEventMap>(tx, workflowsOutbox, {
    type: WORKFLOWS_STEP_RESTART_ENQUEUED,
    payload: {
      jobId: params.jobId,
      runId,
      failedStepId: params.failedStepId,
      failedStepAttempt: params.failedStepAttempt,
      restartFromStepId: params.restartFromStepId,
      reason: params.reason,
    },
  });
}

// Count a single step's own attempts. Used to bound the restart cap on the
// gating step's actual executions — `steps.current_attempt` can't be used for
// the cap because a rewind also bumps it for downstream steps swept into the
// rewind range (which would inflate a later gate's cap in a multi-gate job).
export async function countStepAttempts(stepId: string, tx: Tx): Promise<number> {
  const rows = await tx
    .select({total: count()})
    .from(stepAttempts)
    .where(eq(stepAttempts.stepId, stepId));
  return Number(rows[0]?.total ?? 0);
}

export async function getStepAttempts(jobId: string): Promise<StepAttempt[]> {
  const rows = await db()
    .select()
    .from(stepAttempts)
    .where(eq(stepAttempts.jobId, jobId))
    .orderBy(asc(stepAttempts.stepId), asc(stepAttempts.attempt));
  return rows.map(toStepAttempt);
}

export async function getStepAttemptsByJobIds(jobIds: string[]): Promise<StepAttempt[]> {
  if (jobIds.length === 0) return [];
  const rows = await db()
    .select()
    .from(stepAttempts)
    .where(inArray(stepAttempts.jobId, jobIds))
    .orderBy(asc(stepAttempts.stepId), asc(stepAttempts.attempt));
  return rows.map(toStepAttempt);
}

export interface ApplyStepResultParams {
  jobId: string;
  stepId: string;
  status: 'succeeded' | 'failed';
  error: Record<string, unknown> | null;
}

export async function applyStepResult(params: ApplyStepResultParams, tx: Tx): Promise<void> {
  await tx
    .update(steps)
    .set({status: params.status, error: params.error ?? null, updatedAt: new Date()})
    .where(
      and(
        eq(steps.id, params.stepId),
        eq(steps.jobId, params.jobId),
        sql`${steps.status} NOT IN ('succeeded','failed','cancelled')`,
      ),
    );
}

export interface CancelRemainingStepsParams {
  jobId: string;
}

// The just-failed step is already terminal, so the shared guarded sweep leaves
// it alone and only the still-pending siblings are cancelled.
export async function cancelRemainingSteps(
  params: CancelRemainingStepsParams,
  tx: Tx,
): Promise<void> {
  await bulkUpdateStepStatuses({jobId: params.jobId, status: 'cancelled'}, tx);
}
