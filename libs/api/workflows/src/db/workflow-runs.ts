import type {WorkflowSpec} from '@shipfox/api-definitions';
import {
  WORKFLOW_RUN_CREATED,
  WORKFLOWS_JOB_TIMED_OUT,
  type WorkflowsEventMap,
} from '@shipfox/api-workflows-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, asc, count, desc, eq, gte, inArray, lt, lte, or, type SQL, sql} from 'drizzle-orm';
import type {Job, JobStatus} from '#core/entities/job.js';
import type {Step, StepStatus} from '#core/entities/step.js';
import type {TriggerPayload, WorkflowRun, WorkflowRunStatus} from '#core/entities/workflow-run.js';
import {db} from './db.js';
import {jobs, toJob} from './schema/jobs.js';
import {workflowsOutbox} from './schema/outbox.js';
import {steps, toStep} from './schema/steps.js';
import {toWorkflowRun, workflowRuns} from './schema/workflow-runs.js';

export interface CreateWorkflowRunParams {
  workspaceId: string;
  projectId: string;
  definitionId: string;
  name?: string | undefined;
  definition: WorkflowSpec;
  triggerPayload: TriggerPayload;
  inputs?: Record<string, unknown> | undefined;
}

function normalizeDependencies(needs: string | string[] | undefined): string[] {
  if (!needs) return [];
  return Array.isArray(needs) ? needs : [needs];
}

function normalizeRunner(runner: string | string[] | undefined): string[] | null {
  if (!runner) return null;
  return Array.isArray(runner) ? runner : [runner];
}

export async function createWorkflowRun(params: CreateWorkflowRunParams): Promise<WorkflowRun> {
  return await db().transaction(async (tx) => {
    const [runRow] = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        definitionId: params.definitionId,
        name: params.name ?? params.definition.name,
        status: 'pending',
        triggerSource: params.triggerPayload.source,
        triggerEvent: params.triggerPayload.event,
        triggerPayload: params.triggerPayload,
        inputs: params.inputs ?? null,
      })
      .returning();
    if (!runRow) throw new Error('Insert returned no rows');

    const jobEntries = Object.entries(params.definition.jobs);
    let jobRows: (typeof jobs.$inferSelect)[] = [];

    if (jobEntries.length > 0) {
      jobRows = await tx
        .insert(jobs)
        .values(
          jobEntries.map(([jobName, jobSpec], index) => ({
            runId: runRow.id,
            name: jobName,
            status: 'pending' as const,
            dependencies: normalizeDependencies(jobSpec.needs),
            runner: normalizeRunner(jobSpec.runner),
            position: index,
          })),
        )
        .returning();
    }

    const stepValues: (typeof steps.$inferInsert)[] = [];
    for (const jobRow of jobRows) {
      const jobSpec = params.definition.jobs[jobRow.name];
      if (!jobSpec) continue;
      for (const [stepIndex, stepSpec] of jobSpec.steps.entries()) {
        stepValues.push({
          jobId: jobRow.id,
          name: stepSpec.name ?? null,
          status: 'pending',
          type: 'run',
          config: {run: stepSpec.run},
          position: stepIndex,
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

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

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
  const updated = await db().transaction(async (tx) =>
    updateJobStatusAtVersion(tx, {
      jobId: params.jobId,
      status: params.status,
      expectedVersion: params.expectedVersion,
    }),
  );
  if (!updated)
    throw new Error(
      `Optimistic lock failure: job ${params.jobId} version ${params.expectedVersion}`,
    );
  return updated;
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

export interface BulkUpdateStepStatusesParams {
  jobId: string;
  status: StepStatus;
}

export async function bulkUpdateStepStatuses(params: BulkUpdateStepStatusesParams): Promise<void> {
  await db()
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
}

export interface ReportedStepResult {
  stepId: string;
  status: 'succeeded' | 'failed';
  error: Record<string, unknown> | null;
}

export interface ApplyStepResultsParams {
  jobId: string;
  /**
   * Job-level completion status. When 'succeeded', the activity enforces strict
   * consistency: reported step ids must be the canonical set, with no
   * duplicates and no unknowns. Violations throw — the workflow surfaces the
   * failure and the job stays running until the timeout path catches it.
   */
  completionStatus: 'succeeded' | 'failed';
  reportedSteps: ReportedStepResult[];
}

export class StepResultsContractViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepResultsContractViolationError';
  }
}

/**
 * Persists per-step results from the runner, marks any unreported step in the
 * job as `cancelled`, and never downgrades an already-terminal row.
 *
 *   reportedSteps[] ──► ┌──────────────────────────────────────┐
 *                       │ canonical = SELECT id WHERE job_id=? │
 *                       └──────────────────────────────────────┘
 *                                       │
 *                       ┌───────────────┴───────────────┐
 *                       ▼                               ▼
 *                 reported ∩ canonical          canonical \ reported
 *                  status + error                  status='cancelled'
 *                       │                               │
 *                       ▼                               ▼
 *                   one UPDATE per row,         one UPDATE id IN (...)
 *                   guarded by terminal         guarded by terminal
 *
 * Unknown / cross-job step ids get filtered out by the canonical-set
 * intersection so they cannot leak into either branch.
 */
export async function applyStepResults(params: ApplyStepResultsParams): Promise<void> {
  if (params.reportedSteps.length === 0) {
    if (params.completionStatus === 'succeeded') {
      throw new StepResultsContractViolationError(
        'completionStatus=succeeded with no reported steps',
      );
    }
    await bulkUpdateStepStatuses({jobId: params.jobId, status: 'failed'});
    return;
  }

  await db().transaction(async (tx) => {
    const canonical = await tx
      .select({id: steps.id})
      .from(steps)
      .where(eq(steps.jobId, params.jobId));
    const canonicalIds = new Set(canonical.map((row) => row.id));
    const reportedIdSet = new Set(params.reportedSteps.map((r) => r.stepId));

    if (params.completionStatus === 'succeeded') {
      // Strict mode: every reported id must be canonical, every canonical id
      // must be reported, and the reported list must have no duplicates. A
      // bogus or missing id with status=succeeded would otherwise corrupt the
      // run history (job marked succeeded while real steps end cancelled).
      if (params.reportedSteps.length !== reportedIdSet.size) {
        throw new StepResultsContractViolationError(
          'duplicate stepId in reportedSteps with completionStatus=succeeded',
        );
      }
      const unknown = params.reportedSteps.find((r) => !canonicalIds.has(r.stepId));
      if (unknown) {
        throw new StepResultsContractViolationError(
          `unknown stepId ${unknown.stepId} with completionStatus=succeeded`,
        );
      }
      const missing = canonical.filter((row) => !reportedIdSet.has(row.id));
      if (missing.length > 0) {
        throw new StepResultsContractViolationError(
          `unreported canonical stepIds with completionStatus=succeeded: ${missing.map((r) => r.id).join(', ')}`,
        );
      }
    }

    const updatedAt = new Date();

    for (const reported of params.reportedSteps) {
      if (!canonicalIds.has(reported.stepId)) continue;
      await tx
        .update(steps)
        .set({
          status: reported.status,
          error: reported.error ?? null,
          updatedAt,
        })
        .where(
          and(
            eq(steps.id, reported.stepId),
            eq(steps.jobId, params.jobId),
            sql`${steps.status} NOT IN ('succeeded','failed','cancelled')`,
          ),
        );
    }

    const cancelIds = canonical.map((row) => row.id).filter((id) => !reportedIdSet.has(id));
    if (cancelIds.length > 0) {
      await tx
        .update(steps)
        .set({status: 'cancelled', updatedAt})
        .where(
          and(
            inArray(steps.id, cancelIds),
            sql`${steps.status} NOT IN ('succeeded','failed','cancelled')`,
          ),
        );
    }
  });
}
