import {
  type AgentDefaultsResolver,
  catalogDefaultAgentResolver,
} from '@shipfox/api-agent/core/resolve-agent-config';
import {DEFAULT_JOB_SUCCESS, type WorkflowModel} from '@shipfox/api-definitions';
import {
  type LogOutcomeDto,
  WORKFLOWS_JOB_STEPS_SETTLED,
  WORKFLOWS_JOB_TERMINATED,
  WORKFLOWS_JOB_TIMED_OUT,
  WORKFLOWS_STEP_ATTEMPT_TERMINATED,
  WORKFLOWS_STEP_RESTART_ENQUEUED,
  WORKFLOWS_WORKFLOW_RUN_CANCELLED,
  WORKFLOWS_WORKFLOW_RUN_CREATED,
  WORKFLOWS_WORKFLOW_RUN_TERMINATED,
  type WorkflowsEventMap,
} from '@shipfox/api-workflows-dto';
import {createWorkflowExpression, evaluateWorkflowPredicate} from '@shipfox/expression';
import {
  paginateTimestampIdRows,
  type TimestampIdCursor,
  timestampIdCursorWhere,
} from '@shipfox/node-drizzle';
import {logger} from '@shipfox/node-opentelemetry';
import {writeOutboxEvent, writeOutboxEvents} from '@shipfox/node-outbox';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import {
  isJobTerminal,
  type Job,
  type JobStatus,
  type JobStatusReason,
  toJobStatusReason,
} from '#core/entities/job.js';
import type {JobExecution, JobExecutionStatus} from '#core/entities/job-execution.js';
import type {RuntimeCompletionStatus} from '#core/entities/runtime-dag.js';
import type {Step, StepAttempt, StepAttemptStatus, StepStatus} from '#core/entities/step.js';
import {
  isWorkflowRunTerminal,
  type RunAttemptSummary,
  type TriggerPayload,
  type WorkflowRun,
  type WorkflowRunStatus,
  type WorkflowSourceSnapshot,
} from '#core/entities/workflow-run.js';
import {
  JobNotFoundError,
  NoFailedJobsError,
  RunNotTerminalError,
  SourceRunNotFoundError,
  WorkflowRunNotCancellableError,
  WorkflowRunNotFoundError,
} from '#core/errors.js';
import {deriveCompletion, isTerminal} from '#core/step-transition/decide-step-transition.js';
import type {WorkflowStepTemplateDiagnostic} from '#core/workflow-runtime/index.js';
import {
  assembleWorkflowRunContext,
  materializeWorkflowModel,
} from '#core/workflow-runtime/index.js';
import {
  recordWorkflowJobLeaseExpiryResolved,
  recordWorkflowJobQueued,
  recordWorkflowJobStarted,
  recordWorkflowJobStatusChanged,
  recordWorkflowJobTimedOut,
  recordWorkflowRunCreated,
  recordWorkflowRunStatusChanged,
} from '#metrics/instance.js';
import {db, type Tx} from './db.js';
import {jobExecutions, toJobExecution} from './schema/job-executions.js';
import {jobs, toJob} from './schema/jobs.js';
import {workflowsOutbox} from './schema/outbox.js';
import {stepAttempts, toStepAttempt} from './schema/step-attempts.js';
import {steps, toStep} from './schema/steps.js';
import {toWorkflowRun, workflowRuns} from './schema/workflow-runs.js';

const TERMINAL_WORKFLOW_RUN_STATUSES: WorkflowRunStatus[] = ['succeeded', 'failed', 'cancelled'];
const TERMINAL_JOB_STATUSES: JobStatus[] = ['succeeded', 'failed', 'cancelled', 'skipped'];
const TERMINAL_EXECUTION_STATUSES: JobExecutionStatus[] = ['succeeded', 'failed', 'cancelled'];

export interface CreateWorkflowRunParams {
  workspaceId: string;
  projectId: string;
  definitionId: string;
  name?: string | undefined;
  model: WorkflowModel;
  triggerPayload: TriggerPayload;
  inputs?: Record<string, unknown> | undefined;
  sourceSnapshot?: WorkflowSourceSnapshot | null | undefined;
  triggerIdempotencyKey?: string | undefined;
  resolveAgentDefaults?: AgentDefaultsResolver | undefined;
}

export async function createWorkflowRun(params: CreateWorkflowRunParams): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
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
        sourceSnapshot: params.sourceSnapshot ?? null,
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
      return {run: toWorkflowRun(existingRow), created: false};
    }

    const run = toWorkflowRun(runRow);
    // Resolving templates here gives interpolation access to the inserted run id.
    // If resolution fails, the transaction rolls back the run, jobs, steps, and outbox event together.
    const materializedJobs = materializeWorkflowModel({
      model: params.model,
      context: assembleWorkflowRunContext({
        run,
        triggerPayload: params.triggerPayload,
        inputs: params.inputs ?? null,
      }),
      resolveAgentDefaults: params.resolveAgentDefaults ?? catalogDefaultAgentResolver,
      definitionId: params.definitionId,
    });

    let jobRows: (typeof jobs.$inferSelect)[] = [];

    if (materializedJobs.length > 0) {
      jobRows = await tx
        .insert(jobs)
        .values(
          materializedJobs.map((job) => ({
            runId: runRow.id,
            name: job.sourceName,
            status: 'pending' as const,
            success: job.success ?? null,
            executionTimeoutMs: job.executionTimeoutMs ?? null,
            dependencies: [...job.dependencies],
            runner: job.runner.length === 0 ? null : [...job.runner],
            position: job.position,
          })),
        )
        .returning();
    }

    const executionRows =
      jobRows.length === 0
        ? []
        : await tx
            .insert(jobExecutions)
            .values(
              jobRows.map((jobRow) => ({
                jobId: jobRow.id,
                runId: runRow.id,
                sequence: 1,
                name: jobRow.name,
                status: 'pending' as const,
              })),
            )
            .returning();

    const executionByJobId = new Map(
      executionRows.map((execution) => [execution.jobId, execution]),
    );

    const stepValues: (typeof steps.$inferInsert)[] = [];
    for (const [jobIndex, jobRow] of jobRows.entries()) {
      const job = materializedJobs[jobIndex];
      const execution = executionByJobId.get(jobRow.id);
      if (!execution) continue;
      if (!job) continue;
      for (const step of job.steps) {
        stepValues.push({
          jobId: jobRow.id,
          executionId: execution.id,
          name: step.sourceName,
          displayName: step.displayName,
          sourceLocation: step.sourceLocation,
          status: step.status,
          type: step.type,
          config: step.config,
          authoredConfig: step.authoredConfig,
          position: step.position,
        });
      }
    }

    if (stepValues.length > 0) {
      await tx.insert(steps).values(stepValues);
    }

    await writeOutboxEvent<WorkflowsEventMap>(tx, workflowsOutbox, {
      type: WORKFLOWS_WORKFLOW_RUN_CREATED,
      payload: {
        runId: runRow.id,
        workspaceId: runRow.workspaceId,
        projectId: runRow.projectId,
        definitionId: runRow.definitionId,
      },
    });

    logTemplateDiagnostics({
      runId: runRow.id,
      diagnostics: materializedJobs.flatMap((job) =>
        job.steps.flatMap((step) =>
          (step.diagnostics ?? []).map((diagnostic) => ({
            jobName: job.sourceName,
            stepDisplayName: step.displayName,
            ...diagnostic,
          })),
        ),
      ),
    });

    return {run, created: true};
  });

  if (result.created) recordWorkflowRunCreated(result.run.triggerSource);

  return result.run;
}

export async function getStepByIdForJob(params: {
  stepId: string;
  jobId: string;
}): Promise<Step | undefined> {
  const rows = await db()
    .select()
    .from(steps)
    .where(and(eq(steps.id, params.stepId), eq(steps.jobId, params.jobId)))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toStep(row);
}

export async function getStepByIdForExecution(params: {
  stepId: string;
  executionId: string;
}): Promise<Step | undefined> {
  const rows = await db()
    .select()
    .from(steps)
    .where(and(eq(steps.id, params.stepId), eq(steps.executionId, params.executionId)))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toStep(row);
}

export interface CreateRerunWorkflowRunParams {
  sourceRunId: string;
  mode: 'all' | 'failed';
  actorUserId: string;
}

export async function createRerunWorkflowRun(
  params: CreateRerunWorkflowRunParams,
): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const sourceRows = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, params.sourceRunId))
      .limit(1);
    const sourceRow = sourceRows[0];
    if (!sourceRow) throw new SourceRunNotFoundError(params.sourceRunId);
    if (!isWorkflowRunTerminal(sourceRow.status)) throw new RunNotTerminalError(sourceRow.id);

    const sourceJobs = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.runId, sourceRow.id))
      .orderBy(asc(jobs.position), asc(jobs.id));

    if (
      params.mode === 'failed' &&
      !sourceJobs.some((job) => job.status === 'failed' || job.status === 'cancelled')
    ) {
      throw new NoFailedJobsError(sourceRow.id);
    }

    const rootRunId = sourceRow.rootRunId ?? sourceRow.id;
    // Serialize attempt allocation per lineage; the unique index is the final guard.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${rootRunId}))`);

    if (sourceRow.rootRunId === null) {
      await tx
        .update(workflowRuns)
        .set({rootRunId: sourceRow.id, updatedAt: new Date()})
        .where(and(eq(workflowRuns.id, sourceRow.id), isNull(workflowRuns.rootRunId)));
    }

    const [attemptRow] = await tx
      .select({value: sql<number>`coalesce(max(${workflowRuns.attempt}), 1)`})
      .from(workflowRuns)
      .where(eq(workflowRuns.rootRunId, rootRunId));
    const attempt = Number(attemptRow?.value ?? 1) + 1;

    const [newRunRow] = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: sourceRow.workspaceId,
        projectId: sourceRow.projectId,
        definitionId: sourceRow.definitionId,
        name: sourceRow.name,
        status: 'pending',
        sourceRunId: sourceRow.id,
        rootRunId,
        attempt,
        rerunMode: params.mode,
        rerunByUserId: params.actorUserId,
        triggerSource: sourceRow.triggerSource,
        triggerEvent: sourceRow.triggerEvent,
        triggerPayload: sourceRow.triggerPayload,
        inputs: sourceRow.inputs,
        sourceSnapshot: sourceRow.sourceSnapshot,
        triggerIdempotencyKey: null,
      })
      .returning();
    if (!newRunRow) throw new Error('Insert returned no rows');

    const sourceSteps =
      sourceJobs.length === 0
        ? []
        : await tx
            .select()
            .from(steps)
            .where(
              inArray(
                steps.jobId,
                sourceJobs.map((job) => job.id),
              ),
            )
            .orderBy(asc(steps.jobId), asc(steps.position), asc(steps.id));

    const clonedJobRows =
      sourceJobs.length === 0
        ? []
        : await tx
            .insert(jobs)
            .values(
              sourceJobs.map((job) => {
                const carriedOver = params.mode === 'failed' && job.status === 'succeeded';
                return {
                  runId: newRunRow.id,
                  name: job.name,
                  status: carriedOver ? ('succeeded' as const) : ('pending' as const),
                  statusReason: null,
                  carriedOver,
                  success: job.success,
                  executionTimeoutMs: job.executionTimeoutMs,
                  dependencies: [...job.dependencies],
                  runner: job.runner ? [...job.runner] : null,
                  position: job.position,
                };
              }),
            )
            .returning();

    const clonedExecutionRows =
      clonedJobRows.length === 0
        ? []
        : await tx
            .insert(jobExecutions)
            .values(
              clonedJobRows.map((job) => {
                const carriedOver = params.mode === 'failed' && job.status === 'succeeded';
                return {
                  jobId: job.id,
                  runId: newRunRow.id,
                  sequence: 1,
                  name: job.name,
                  status: carriedOver ? ('succeeded' as const) : ('pending' as const),
                  statusReason: null,
                  ...(carriedOver ? {finishedAt: sql`now()`} : {}),
                };
              }),
            )
            .returning();

    const sourceJobById = new Map(sourceJobs.map((job) => [job.id, job]));
    const clonedJobByPosition = new Map(clonedJobRows.map((job) => [job.position, job]));
    const clonedExecutionByJobId = new Map(
      clonedExecutionRows.map((execution) => [execution.jobId, execution]),
    );
    const stepValues = sourceSteps.flatMap((step) => {
      const sourceJob = sourceJobById.get(step.jobId);
      if (!sourceJob) return [];
      const clonedJob = clonedJobByPosition.get(sourceJob.position);
      if (!clonedJob) return [];
      const clonedExecution = clonedExecutionByJobId.get(clonedJob.id);
      if (!clonedExecution) return [];
      const carriedOver = params.mode === 'failed' && sourceJob.status === 'succeeded';
      return [
        {
          jobId: clonedJob.id,
          executionId: clonedExecution.id,
          name: step.name,
          displayName: step.displayName,
          sourceLocation: step.sourceLocation,
          status: carriedOver ? step.status : ('pending' as const),
          type: step.type,
          config: step.config,
          authoredConfig: step.authoredConfig,
          output: carriedOver ? step.output : null,
          error: null,
          position: step.position,
          currentAttempt: 1,
        },
      ];
    });

    if (stepValues.length > 0) {
      await tx.insert(steps).values(stepValues);
    }

    await writeOutboxEvent<WorkflowsEventMap>(tx, workflowsOutbox, {
      type: WORKFLOWS_WORKFLOW_RUN_CREATED,
      payload: {
        runId: newRunRow.id,
        workspaceId: newRunRow.workspaceId,
        projectId: newRunRow.projectId,
        definitionId: newRunRow.definitionId,
      },
    });

    return toWorkflowRun(newRunRow);
  });

  recordWorkflowRunCreated(result.triggerSource);

  return result;
}

function logTemplateDiagnostics(params: {
  readonly runId: string;
  readonly diagnostics: readonly (WorkflowStepTemplateDiagnostic & {
    readonly jobName: string;
    readonly stepDisplayName: string;
  })[];
}): void {
  if (params.diagnostics.length === 0) return;

  logger().warn(
    {runId: params.runId, diagnostics: params.diagnostics},
    'Workflow interpolation resolved with diagnostics',
  );
}

export async function getWorkflowRunById(id: string): Promise<WorkflowRun | undefined> {
  const rows = await db().select().from(workflowRuns).where(eq(workflowRuns.id, id)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toWorkflowRun(row);
}

export async function listRunAttempts(params: {
  rootRunId: string;
  projectId: string;
}): Promise<RunAttemptSummary[]> {
  return await db()
    .select({
      id: workflowRuns.id,
      attempt: workflowRuns.attempt,
      status: workflowRuns.status,
      createdAt: workflowRuns.createdAt,
      rerunMode: workflowRuns.rerunMode,
    })
    .from(workflowRuns)
    .where(
      and(
        or(eq(workflowRuns.rootRunId, params.rootRunId), eq(workflowRuns.id, params.rootRunId)),
        eq(workflowRuns.projectId, params.projectId),
      ),
    )
    .orderBy(asc(workflowRuns.attempt));
}

export async function getLatestAttempt(params: {
  rootRunId: string;
  projectId: string;
}): Promise<number> {
  const [row] = await db()
    .select({value: sql<number>`coalesce(max(${workflowRuns.attempt}), 1)`})
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.rootRunId, params.rootRunId),
        eq(workflowRuns.projectId, params.projectId),
      ),
    );

  return Number(row?.value ?? 1);
}

export type WorkflowRunCursor = TimestampIdCursor;

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

export function buildWorkflowRunListConditions(params: {
  projectId: string;
  filters?: WorkflowRunFilters | undefined;
  cursor?: WorkflowRunCursor | undefined;
  omit?: 'status' | 'definitionId' | 'triggerSource' | undefined;
}): SQL[] {
  const filters = params.filters;
  const conditions: SQL[] = [eq(workflowRuns.projectId, params.projectId)];
  const cursorCondition = timestampIdCursorWhere({
    timestampColumn: workflowRuns.createdAt,
    idColumn: workflowRuns.id,
    cursor: params.cursor,
  });
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

  const page = paginateTimestampIdRows({rows, limit: params.limit, timestampKey: 'createdAt'});

  return {
    runs: page.pageRows.map(toWorkflowRun),
    nextCursor: page.nextCursor,
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

export interface WorkflowExecutionDepth {
  runningRuns: number;
  runningJobs: number;
}

export interface WorkflowExecutionDepthParams {
  workspaceId?: string;
}

export async function getWorkflowExecutionDepth(
  params: WorkflowExecutionDepthParams = {},
): Promise<WorkflowExecutionDepth> {
  const runConditions = [eq(workflowRuns.status, 'running')];
  const jobConditions = [eq(jobExecutions.status, 'running')];
  if (params.workspaceId) {
    runConditions.push(eq(workflowRuns.workspaceId, params.workspaceId));
    jobConditions.push(eq(workflowRuns.workspaceId, params.workspaceId));
  }

  const jobQuery = params.workspaceId
    ? db()
        .select({value: count()})
        .from(jobExecutions)
        .innerJoin(workflowRuns, eq(jobExecutions.runId, workflowRuns.id))
        .where(and(...jobConditions))
    : db()
        .select({value: count()})
        .from(jobExecutions)
        .where(and(...jobConditions));

  const [runRows, jobRows] = await Promise.all([
    db()
      .select({value: count()})
      .from(workflowRuns)
      .where(and(...runConditions)),
    jobQuery,
  ]);

  return {
    runningRuns: runRows[0]?.value ?? 0,
    runningJobs: jobRows[0]?.value ?? 0,
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

export async function getJobById(id: string): Promise<Job | undefined> {
  const rows = await db().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toJob(row);
}

export async function getJobWorkspaceId(jobId: string): Promise<string | undefined> {
  const rows = await db()
    .select({workspaceId: workflowRuns.workspaceId})
    .from(jobs)
    .innerJoin(workflowRuns, eq(jobs.runId, workflowRuns.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  return rows[0]?.workspaceId;
}

export async function getStepsByJobId(jobId: string): Promise<Step[]> {
  const rows = await db()
    .select()
    .from(steps)
    .where(eq(steps.jobId, jobId))
    .orderBy(asc(steps.position));
  return rows.map(toStep);
}

export async function getStepsByExecutionId(executionId: string): Promise<Step[]> {
  const rows = await db()
    .select()
    .from(steps)
    .where(eq(steps.executionId, executionId))
    .orderBy(asc(steps.position));
  return rows.map(toStep);
}

export async function getStepsByExecutionIds(executionIds: string[]): Promise<Step[]> {
  if (executionIds.length === 0) return [];
  const rows = await db()
    .select()
    .from(steps)
    .where(inArray(steps.executionId, executionIds))
    .orderBy(asc(steps.executionId), asc(steps.position));
  return rows.map(toStep);
}

export async function getExecutionsByRunId(runId: string): Promise<JobExecution[]> {
  const rows = await db()
    .select()
    .from(jobExecutions)
    .where(eq(jobExecutions.runId, runId))
    .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));
  return rows.map(toJobExecution);
}

export async function getExecutionsByJobId(jobId: string): Promise<JobExecution[]> {
  const rows = await db()
    .select()
    .from(jobExecutions)
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));
  return rows.map(toJobExecution);
}

export async function getFirstExecutionByJobId(
  jobId: string,
  tx?: Tx,
): Promise<JobExecution | undefined> {
  const rows = await (tx ?? db())
    .select()
    .from(jobExecutions)
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id))
    .limit(1);
  const row = rows[0];
  return row ? toJobExecution(row) : undefined;
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

export interface CancelWorkflowRunParams {
  runId: string;
}

export async function cancelWorkflowRun(params: CancelWorkflowRunParams): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const runJobIds = tx.select({id: jobs.id}).from(jobs).where(eq(jobs.runId, params.runId));

    await tx
      .select({id: steps.id})
      .from(steps)
      .where(inArray(steps.jobId, runJobIds))
      .orderBy(asc(steps.jobId), asc(steps.position))
      .for('update');

    const jobRows = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.runId, params.runId))
      .orderBy(asc(jobs.position), asc(jobs.id))
      .for('update');

    const [lockedRun] = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, params.runId))
      .limit(1)
      .for('update');

    if (!lockedRun) {
      throw new WorkflowRunNotFoundError(params.runId);
    }
    if (isWorkflowRunTerminal(lockedRun.status)) {
      throw new WorkflowRunNotCancellableError(lockedRun.id, lockedRun.status);
    }

    const cancelledJobs: Job[] = [];
    for (const jobRow of jobRows) {
      if (isJobTerminal(jobRow.status)) continue;

      const updated = await updateJobStatusAtVersion(tx, {
        jobId: jobRow.id,
        status: 'cancelled',
        expectedVersion: jobRow.version,
        statusReason: 'run_cancelled',
      });
      if (updated?.changed) cancelledJobs.push(updated.job);
      await tx
        .update(jobExecutions)
        .set({
          status: 'cancelled',
          statusReason: 'run_cancelled',
          version: sql`${jobExecutions.version} + 1`,
          updatedAt: new Date(),
          finishedAt: sql`now()`,
        })
        .where(
          and(
            eq(jobExecutions.jobId, jobRow.id),
            notInArray(jobExecutions.status, TERMINAL_EXECUTION_STATUSES),
          ),
        );
      await bulkUpdateStepStatuses({jobId: jobRow.id, status: 'cancelled'}, tx);
    }

    const [cancelledRunRow] = await tx
      .update(workflowRuns)
      .set({
        status: 'cancelled',
        version: sql`${workflowRuns.version} + 1`,
        updatedAt: new Date(),
        finishedAt: sql`now()`,
      })
      .where(and(eq(workflowRuns.id, lockedRun.id), eq(workflowRuns.version, lockedRun.version)))
      .returning();

    if (!cancelledRunRow) {
      throw new Error(`Optimistic lock failure: run ${lockedRun.id} version ${lockedRun.version}`);
    }

    const cancelledRun = toWorkflowRun(cancelledRunRow);
    await writeOutboxEvents<WorkflowsEventMap>(tx, workflowsOutbox, [
      {
        type: WORKFLOWS_WORKFLOW_RUN_TERMINATED,
        payload: {
          runId: cancelledRun.id,
          projectId: cancelledRun.projectId,
          status: 'cancelled',
        },
      },
      {
        type: WORKFLOWS_WORKFLOW_RUN_CANCELLED,
        payload: {runId: cancelledRun.id, projectId: cancelledRun.projectId},
      },
    ]);

    return {run: cancelledRun, cancelledJobs};
  });

  recordWorkflowRunStatusChanged(result.run.status);
  for (const job of result.cancelledJobs) recordWorkflowJobStatusChanged(job.status);

  return result.run;
}

export interface UpdateWorkflowRunStatusParams {
  runId: string;
  status: WorkflowRunStatus;
  expectedVersion: number;
}

export async function updateWorkflowRunStatus(
  params: UpdateWorkflowRunStatusParams,
): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const rows = await tx
      .update(workflowRuns)
      .set({
        status: params.status,
        version: sql`${workflowRuns.version} + 1`,
        updatedAt: new Date(),
        // Preserve the original start time if a retried transition re-enters `running`.
        // Both endpoints use the DB clock (`now()`): the runner module shares this
        // Postgres instance, so every timing column sits on one clock and a duration is
        // never subtracted across hosts.
        ...(params.status === 'running'
          ? {startedAt: sql`coalesce(${workflowRuns.startedAt}, now())`}
          : {}),
        ...(isWorkflowRunTerminal(params.status) ? {finishedAt: sql`now()`} : {}),
      })
      .where(
        and(
          eq(workflowRuns.id, params.runId),
          eq(workflowRuns.version, params.expectedVersion),
          notInArray(workflowRuns.status, TERMINAL_WORKFLOW_RUN_STATUSES),
        ),
      )
      .returning();

    const row = rows[0];
    if (!row) {
      // Idempotent under Temporal retry-after-commit: the committed first attempt
      // left the row at version+1, so this retry matches 0 rows. run-orchestration is
      // the sole writer, so an already-matching status means the prior attempt won;
      // return it without re-emitting, rather than throw and wedge the run.
      const existing = await tx
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, params.runId))
        .limit(1);
      const existingRow = existing[0];
      if (
        existingRow &&
        (existingRow.status === params.status || isWorkflowRunTerminal(existingRow.status))
      ) {
        return {run: toWorkflowRun(existingRow), changed: false};
      }
      throw new Error(
        `Optimistic lock failure: run ${params.runId} version ${params.expectedVersion}`,
      );
    }

    const run = toWorkflowRun(row);

    // Same as updateJobStatusAtVersion: emitting in the same transaction as the
    // guarded status flip makes the run-terminal fact fire exactly once.
    if (isWorkflowRunTerminal(run.status)) {
      await writeOutboxEvent<WorkflowsEventMap>(tx, workflowsOutbox, {
        type: WORKFLOWS_WORKFLOW_RUN_TERMINATED,
        payload: {runId: run.id, projectId: run.projectId, status: run.status},
      });
    }

    return {run, changed: true};
  });

  if (result.changed) recordWorkflowRunStatusChanged(result.run.status);

  return result.run;
}

export interface UpdateJobStatusAtVersionParams {
  jobId: string;
  status: JobStatus;
  expectedVersion: number;
  statusReason?: JobStatusReason | null | undefined;
  markTimedOut?: boolean;
}

export interface UpdateExecutionStatusAtVersionParams {
  executionId: string;
  status: JobExecutionStatus;
  expectedVersion: number;
  statusReason?: JobStatusReason | null | undefined;
  markTimedOut?: boolean;
}

async function updateExecutionStatusAtVersion(
  tx: Tx,
  params: UpdateExecutionStatusAtVersionParams,
): Promise<{execution: JobExecution; changed: boolean} | null> {
  const rows = await tx
    .update(jobExecutions)
    .set({
      status: params.status,
      statusReason: params.statusReason ?? null,
      version: sql`${jobExecutions.version} + 1`,
      updatedAt: new Date(),
      ...(params.status === 'running'
        ? {startedAt: sql`coalesce(${jobExecutions.startedAt}, now())`}
        : {}),
      ...(params.markTimedOut ? {timedOutAt: new Date()} : {}),
      ...(TERMINAL_EXECUTION_STATUSES.includes(params.status) ? {finishedAt: sql`now()`} : {}),
    })
    .where(
      and(
        eq(jobExecutions.id, params.executionId),
        eq(jobExecutions.version, params.expectedVersion),
        notInArray(jobExecutions.status, TERMINAL_EXECUTION_STATUSES),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) return null;
  return {execution: toJobExecution(row), changed: true};
}

export interface UpdateExecutionStatusParams {
  executionId: string;
  status: JobExecutionStatus;
  expectedVersion: number;
  statusReason?: JobStatusReason | null | undefined;
}

export async function updateExecutionStatus(
  params: UpdateExecutionStatusParams,
): Promise<JobExecution> {
  const statusReason = params.statusReason ?? null;
  const result = await db().transaction(async (tx) => {
    const updated = await updateExecutionStatusAtVersion(tx, {
      executionId: params.executionId,
      status: params.status,
      expectedVersion: params.expectedVersion,
      statusReason,
    });
    if (updated) return updated;

    const existing = await tx
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.id, params.executionId))
      .limit(1);
    const row = existing[0];
    if (
      row &&
      ((row.status === params.status && row.statusReason === statusReason) ||
        TERMINAL_EXECUTION_STATUSES.includes(row.status))
    ) {
      return {execution: toJobExecution(row), changed: false};
    }
    throw new Error(
      `Optimistic lock failure: execution ${params.executionId} version ${params.expectedVersion}`,
    );
  });

  return result.execution;
}

// Returns null on version mismatch so callers can choose throw vs treat-as-success.
async function updateJobStatusAtVersion(
  tx: Tx,
  params: UpdateJobStatusAtVersionParams,
): Promise<{job: Job; changed: boolean} | null> {
  const rows = await tx
    .update(jobs)
    .set({
      status: params.status,
      statusReason: params.statusReason ?? null,
      version: sql`${jobs.version} + 1`,
      updatedAt: new Date(),
      ...(params.markTimedOut ? {timedOutAt: new Date()} : {}),
      // DB clock so finished_at shares the runner-sourced queued_at/started_at clock.
      ...(isJobTerminal(params.status) ? {finishedAt: sql`now()`} : {}),
    })
    .where(
      and(
        eq(jobs.id, params.jobId),
        eq(jobs.version, params.expectedVersion),
        notInArray(jobs.status, TERMINAL_JOB_STATUSES),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) return null;
  const job = toJob(row);

  // Every terminal job-status write funnels through this one guarded UPDATE, where the
  // version match lets a single caller win. Emitting here, in the same transaction,
  // makes the terminal fact fire exactly once across all paths.
  if (isJobTerminal(job.status)) {
    await writeOutboxEvent<WorkflowsEventMap>(tx, workflowsOutbox, {
      type: WORKFLOWS_JOB_TERMINATED,
      payload: {
        jobId: job.id,
        runId: job.runId,
        status: job.status,
        statusReason: job.statusReason,
      },
    });
  }

  return {job, changed: true};
}

export interface UpdateJobStatusParams {
  jobId: string;
  status: JobStatus;
  expectedVersion: number;
  statusReason?: JobStatusReason | null | undefined;
}

export async function updateJobStatus(params: UpdateJobStatusParams): Promise<Job> {
  const statusReason = params.statusReason ?? null;
  const result = await db().transaction(async (tx) => {
    const updated = await updateJobStatusAtVersion(tx, {
      jobId: params.jobId,
      status: params.status,
      expectedVersion: params.expectedVersion,
      statusReason,
    });
    if (updated) return updated;

    // Idempotent under Temporal activity retry: a lost result after a committed
    // status update leaves the row at version+1, so the retried call's
    // expected-version UPDATE matches 0 rows. If the row is already in the
    // requested status, the prior attempt of this same transition won — return it
    // instead of throwing an optimistic-lock error that would wedge the workflow.
    const existing = await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1);
    const row = existing[0];
    if (
      row &&
      ((row.status === params.status && row.statusReason === statusReason) ||
        isJobTerminal(row.status))
    ) {
      return {job: toJob(row), changed: false};
    }
    throw new Error(
      `Optimistic lock failure: job ${params.jobId} version ${params.expectedVersion}`,
    );
  });

  if (result.changed) recordWorkflowJobStatusChanged(result.job.status);

  return result.job;
}

// Project the runner-owned queue/claim moments onto the durable job row. The null
// guard makes redelivery and out-of-order delivery first-write-wins, so the
// at-least-once outbox can replay these freely. Eventually consistent by design:
// the column stays null until the runner event drains.
export async function recordJobQueuedAt(params: {jobId: string; queuedAt: Date}): Promise<void> {
  const updated = await db()
    .update(jobs)
    .set({queuedAt: params.queuedAt})
    .where(and(eq(jobs.id, params.jobId), isNull(jobs.queuedAt)))
    .returning({id: jobs.id});

  if (updated.length > 0) recordWorkflowJobQueued();
}

export async function recordJobStartedAt(params: {jobId: string; startedAt: Date}): Promise<void> {
  const updated = await db()
    .update(jobs)
    .set({startedAt: params.startedAt})
    .where(and(eq(jobs.id, params.jobId), isNull(jobs.startedAt)))
    .returning({id: jobs.id});

  if (updated.length > 0) recordWorkflowJobStarted();
}

export async function recordExecutionQueuedAt(params: {
  executionId: string;
  queuedAt: Date;
}): Promise<void> {
  const updated = await db()
    .update(jobExecutions)
    .set({queuedAt: params.queuedAt})
    .where(and(eq(jobExecutions.id, params.executionId), isNull(jobExecutions.queuedAt)))
    .returning({id: jobExecutions.id});

  if (updated.length > 0) recordWorkflowJobQueued();
}

export async function recordExecutionStartedAt(params: {
  executionId: string;
  startedAt: Date;
}): Promise<void> {
  const updated = await db()
    .update(jobExecutions)
    .set({startedAt: params.startedAt})
    .where(and(eq(jobExecutions.id, params.executionId), isNull(jobExecutions.startedAt)))
    .returning({id: jobExecutions.id});

  if (updated.length > 0) recordWorkflowJobStarted();
}

export interface FailJobAsTimedOutParams {
  jobId: string;
  runId: string;
  expectedVersion: number;
}

export async function failExecutionAsTimedOut(params: {
  executionId: string;
  runId: string;
  expectedVersion: number;
}): Promise<JobExecution> {
  const result = await db().transaction(async (tx) => {
    const updated = await updateExecutionStatusAtVersion(tx, {
      executionId: params.executionId,
      status: 'failed',
      expectedVersion: params.expectedVersion,
      statusReason: 'timed_out',
      markTimedOut: true,
    });

    if (!updated) {
      const existing = await tx
        .select()
        .from(jobExecutions)
        .where(eq(jobExecutions.id, params.executionId))
        .limit(1);
      const row = existing[0];
      if (row && row.timedOutAt !== null) {
        return {execution: toJobExecution(row), changed: false};
      }
      throw new Error(
        `Optimistic lock failure: execution ${params.executionId} version ${params.expectedVersion}`,
      );
    }

    await writeOutboxEvent<WorkflowsEventMap>(tx, workflowsOutbox, {
      type: WORKFLOWS_JOB_TIMED_OUT,
      payload: {
        jobId: updated.execution.jobId,
        executionId: params.executionId,
        runId: params.runId,
      },
    });

    return updated;
  });

  if (result.changed) recordWorkflowJobTimedOut();

  return result.execution;
}

// Idempotent under retry: a 0-row UPDATE re-reads the row, and a non-null
// `timed_out_at` proves an earlier attempt of this same activity already
// finalized — return its version without writing a second outbox event.
export async function failJobAsTimedOut(params: FailJobAsTimedOutParams): Promise<Job> {
  const result = await db().transaction(async (tx) => {
    const updated = await updateJobStatusAtVersion(tx, {
      jobId: params.jobId,
      status: 'failed',
      expectedVersion: params.expectedVersion,
      statusReason: 'timed_out',
      markTimedOut: true,
    });

    if (!updated) {
      const existing = await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1);
      const row = existing[0];
      if (row && row.timedOutAt !== null) {
        return {job: toJob(row), changed: false};
      }
      throw new Error(
        `Optimistic lock failure: job ${params.jobId} version ${params.expectedVersion}`,
      );
    }

    const executionRow = (
      await tx
        .select({id: jobExecutions.id})
        .from(jobExecutions)
        .where(eq(jobExecutions.jobId, params.jobId))
        .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id))
        .limit(1)
    )[0];
    if (!executionRow) throw new Error(`Cannot time out job ${params.jobId}: no execution found`);

    await writeOutboxEvent<WorkflowsEventMap>(tx, workflowsOutbox, {
      type: WORKFLOWS_JOB_TIMED_OUT,
      payload: {jobId: params.jobId, executionId: executionRow.id, runId: params.runId},
    });

    return updated;
  });

  if (result.changed) {
    recordWorkflowJobStatusChanged(result.job.status);
    recordWorkflowJobTimedOut();
  }

  return result.job;
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
 *        │                        WORKFLOWS_JOB_STEPS_SETTLED). Adopt deriveCompletion.
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
  const result = await db().transaction(async (tx) => {
    const jobSteps = await getStepsByJobIdForUpdate(params.jobId, tx);
    let changedJob: Job | null = null;

    // A job with no steps is malformed, not a runner-died-mid-job failure. Surface
    // it loudly instead of silently marking the job failed and hiding the bad state.
    // The activity translates this to a non-retryable failure so it fails fast.
    if (jobSteps.length === 0) {
      throw new JobNotFoundError(params.jobId);
    }

    if (jobSteps.every((step) => isTerminal(step.status))) {
      const status = deriveCompletion(jobSteps);
      const updated = await updateJobStatusAtVersion(tx, {
        jobId: params.jobId,
        status,
        expectedVersion: params.expectedVersion,
        statusReason: statusReasonForStepCompletion(status),
      });
      changedJob = updated?.changed ? updated.job : null;
    } else {
      const updated = await updateJobStatusAtVersion(tx, {
        jobId: params.jobId,
        status: 'failed',
        expectedVersion: params.expectedVersion,
        statusReason: 'runner_lost',
      });
      changedJob = updated?.changed ? updated.job : null;
      await bulkUpdateStepStatuses({jobId: params.jobId, status: 'cancelled'}, tx);
    }

    const row = (await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1))[0];
    if (!row) throw new Error(`Job not found resolving lease expiry: ${params.jobId}`);
    const status: RuntimeCompletionStatus = row.status === 'succeeded' ? 'succeeded' : 'failed';
    return {status, jobVersion: row.version, changedJob};
  });

  recordWorkflowJobLeaseExpiryResolved(result.status);
  if (result.changedJob) recordWorkflowJobStatusChanged(result.changedJob.status);

  return {status: result.status, jobVersion: result.jobVersion};
}

export async function resolveExecutionAfterLeaseExpiry(params: {
  executionId: string;
  expectedVersion: number;
}): Promise<{status: RuntimeCompletionStatus; executionVersion: number}> {
  const result = await db().transaction(async (tx) => {
    const executionSteps = await getStepsByExecutionIdForUpdate(params.executionId, tx);
    let changedExecution: JobExecution | null = null;

    if (executionSteps.length === 0) {
      throw new JobNotFoundError(params.executionId);
    }

    if (executionSteps.every((step) => isTerminal(step.status))) {
      const status = deriveCompletion(executionSteps);
      const updated = await updateExecutionStatusAtVersion(tx, {
        executionId: params.executionId,
        status,
        expectedVersion: params.expectedVersion,
        statusReason: statusReasonForStepCompletion(status),
      });
      changedExecution = updated?.changed ? updated.execution : null;
    } else {
      const updated = await updateExecutionStatusAtVersion(tx, {
        executionId: params.executionId,
        status: 'failed',
        expectedVersion: params.expectedVersion,
        statusReason: 'runner_lost',
      });
      changedExecution = updated?.changed ? updated.execution : null;
      await bulkUpdateStepStatuses({executionId: params.executionId, status: 'cancelled'}, tx);
    }

    const row = (
      await tx.select().from(jobExecutions).where(eq(jobExecutions.id, params.executionId)).limit(1)
    )[0];
    if (!row) throw new Error(`Execution not found resolving lease expiry: ${params.executionId}`);
    const status: RuntimeCompletionStatus = row.status === 'succeeded' ? 'succeeded' : 'failed';
    return {status, executionVersion: row.version, changedExecution};
  });

  recordWorkflowJobLeaseExpiryResolved(result.status);

  return {status: result.status, executionVersion: result.executionVersion};
}

function statusReasonForStepCompletion(status: RuntimeCompletionStatus): JobStatusReason | null {
  return status === 'failed' ? 'step_failed' : null;
}

export async function resolveJobStatusFromExecutions(params: {
  jobId: string;
}): Promise<{status: RuntimeCompletionStatus; jobVersion: number}> {
  const result = await db().transaction(async (tx) => {
    const jobRow = (await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1))[0];
    if (!jobRow) throw new JobNotFoundError(params.jobId);

    const executionRows = await tx
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.jobId, params.jobId))
      .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));

    if (executionRows.length === 0) {
      throw new Error(`Cannot resolve job ${params.jobId}: no executions found`);
    }

    const expression = createWorkflowExpression({
      source: jobRow.success ?? DEFAULT_JOB_SUCCESS,
      check: {mode: 'syntax'},
    });
    const passed = evaluateWorkflowPredicate(expression, {
      executions: executionRows.map((execution, index) => ({
        index,
        status: execution.status,
      })),
    });
    const status: RuntimeCompletionStatus = passed ? 'succeeded' : 'failed';
    const statusReason =
      status === 'failed'
        ? (executionRows.find((execution) => execution.statusReason)?.statusReason ?? 'step_failed')
        : null;

    const updated = await updateJobStatusAtVersion(tx, {
      jobId: params.jobId,
      status,
      expectedVersion: jobRow.version,
      statusReason: toJobStatusReason(statusReason),
    });
    if (updated) return updated.job;

    const existing = (await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1))[0];
    if (!existing) throw new JobNotFoundError(params.jobId);
    return toJob(existing);
  });

  recordWorkflowJobStatusChanged(result.status);
  return {
    status: result.status === 'succeeded' ? 'succeeded' : 'failed',
    jobVersion: result.version,
  };
}

// Enqueue the steps-settled signal in the same transaction as the final per-step
// result, so per-step execution observes it exactly once (the outbox is at-least-once;
// the job workflow dedupes the signal). Drives the Temporal JOB_FINISHED_SIGNAL; the
// job's terminal fact is emitted separately by updateJobStatusAtVersion.
export async function writeJobStepsSettledOutbox(
  tx: Tx,
  params: {jobId: string; executionId: string; status: 'succeeded' | 'failed'},
): Promise<void> {
  const rows = await tx
    .select({runId: jobs.runId})
    .from(jobs)
    .where(eq(jobs.id, params.jobId))
    .limit(1);
  const runId = rows[0]?.runId;
  if (!runId) {
    throw new Error(`Cannot enqueue job-steps-settled event: job ${params.jobId} not found`);
  }

  await writeOutboxEvent<WorkflowsEventMap>(tx, workflowsOutbox, {
    type: WORKFLOWS_JOB_STEPS_SETTLED,
    payload: {jobId: params.jobId, executionId: params.executionId, runId, status: params.status},
  });
}

export interface BulkUpdateStepStatusesParams {
  jobId?: string;
  executionId?: string;
  status: StepStatus;
}

export async function bulkUpdateStepStatuses(
  params: BulkUpdateStepStatusesParams,
  tx?: Tx,
): Promise<void> {
  if (!tx) {
    await db().transaction((transaction) => bulkUpdateStepStatuses(params, transaction));
    return;
  }

  const scope =
    params.executionId !== undefined
      ? eq(steps.executionId, params.executionId)
      : params.jobId !== undefined
        ? eq(steps.jobId, params.jobId)
        : undefined;
  if (!scope) throw new Error('bulkUpdateStepStatuses requires jobId or executionId');

  await tx
    .update(steps)
    .set({
      status: params.status,
      updatedAt: new Date(),
    })
    .where(and(scope, sql`${steps.status} NOT IN ('succeeded','failed','cancelled')`));

  // Finalize any open attempt rows for the steps just terminalized, so a
  // dispatched-then-timed-out/cancelled step never leaves a `running` audit row
  // stranded (it would otherwise read as phantom in-flight work to gate/restart
  // logic). The just-failed step on the normal report path is already terminal,
  // so this only catches the bulk timeout/cancel sweeps.
  // Only ever called with a terminal sweep status (cancelled on the failed-sibling
  // path, failed on timeout).
  if (params.status === 'failed' || params.status === 'cancelled') {
    const finalizedAttempts = await tx
      .update(stepAttempts)
      .set({status: params.status, logOutcome: 'abandoned', finishedAt: new Date()})
      .where(
        and(
          params.executionId !== undefined
            ? eq(stepAttempts.executionId, params.executionId)
            : eq(stepAttempts.jobId, params.jobId ?? ''),
          eq(stepAttempts.status, 'running'),
        ),
      )
      .returning({
        jobId: stepAttempts.jobId,
        stepId: stepAttempts.stepId,
        attempt: stepAttempts.attempt,
        logOutcome: stepAttempts.logOutcome,
      });

    if (finalizedAttempts.length > 0) {
      const firstAttempt = finalizedAttempts[0];
      if (!firstAttempt) return;
      const identity = await getStepAttemptTerminatedOutboxIdentity(tx, firstAttempt.jobId);
      await writeOutboxEvents<WorkflowsEventMap>(
        tx,
        workflowsOutbox,
        finalizedAttempts.map((attempt) => ({
          type: WORKFLOWS_STEP_ATTEMPT_TERMINATED,
          payload: {
            jobId: attempt.jobId,
            runId: identity.runId,
            workspaceId: identity.workspaceId,
            projectId: identity.projectId,
            stepId: attempt.stepId,
            attempt: attempt.attempt,
            logOutcome: attempt.logOutcome ?? 'abandoned',
          },
        })),
      );
    }
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

export async function getStepsByExecutionIdForUpdate(executionId: string, tx: Tx): Promise<Step[]> {
  const rows = await tx
    .select()
    .from(steps)
    .where(eq(steps.executionId, executionId))
    .orderBy(asc(steps.position))
    .for('update');
  return rows.map(toStep);
}

export interface MarkStepRunningParams {
  executionId: string;
  stepId: string;
}

export async function markStepRunning(params: MarkStepRunningParams, tx: Tx): Promise<Step | null> {
  const rows = await tx
    .update(steps)
    .set({status: 'running', updatedAt: new Date()})
    .where(
      and(
        eq(steps.id, params.stepId),
        eq(steps.executionId, params.executionId),
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
    {
      jobId: step.jobId,
      executionId: step.executionId ?? step.jobId,
      stepId: step.id,
      attempt: step.currentAttempt,
    },
    tx,
  );
  return step;
}

export interface InsertRunningStepAttemptParams {
  jobId: string;
  executionId: string;
  stepId: string;
  attempt: number;
}

export async function insertRunningStepAttempt(
  params: InsertRunningStepAttemptParams,
  tx: Tx,
): Promise<void> {
  const [{nextExecutionOrder} = {nextExecutionOrder: 1}] = await tx
    .select({
      nextExecutionOrder: sql<number>`coalesce(max(${stepAttempts.executionOrder}), 0) + 1`,
    })
    .from(stepAttempts)
    .where(eq(stepAttempts.executionId, params.executionId));

  await tx
    .insert(stepAttempts)
    .values({
      jobId: params.jobId,
      executionId: params.executionId,
      stepId: params.stepId,
      attempt: params.attempt,
      executionOrder: nextExecutionOrder,
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
  logOutcome: LogOutcomeDto;
  gateResult?: Record<string, unknown> | null;
  restartReason?: string | null;
}

// Finalize the running attempt to a terminal state. The `status='running'` guard
// makes this idempotent: a duplicate report finds the attempt already terminal
// and updates nothing (never-downgrade for the audit row).
export async function finishStepAttempt(params: FinishStepAttemptParams, tx: Tx): Promise<void> {
  const rows = await tx
    .update(stepAttempts)
    .set({
      status: params.status,
      output: params.output ?? null,
      error: params.error ?? null,
      exitCode: params.exitCode ?? null,
      logOutcome: params.logOutcome,
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
    )
    .returning({
      jobId: stepAttempts.jobId,
      stepId: stepAttempts.stepId,
      attempt: stepAttempts.attempt,
      logOutcome: stepAttempts.logOutcome,
    });

  const row = rows[0];
  if (!row) return;

  await writeStepAttemptTerminatedOutbox(tx, {
    jobId: row.jobId,
    stepId: row.stepId,
    attempt: row.attempt,
    logOutcome: row.logOutcome ?? params.logOutcome,
  });
}

export async function writeStepAttemptTerminatedOutbox(
  tx: Tx,
  params: {jobId: string; stepId: string; attempt: number; logOutcome: LogOutcomeDto},
): Promise<void> {
  const identity = await getStepAttemptTerminatedOutboxIdentity(tx, params.jobId);

  await writeOutboxEvent<WorkflowsEventMap>(tx, workflowsOutbox, {
    type: WORKFLOWS_STEP_ATTEMPT_TERMINATED,
    payload: {
      jobId: params.jobId,
      runId: identity.runId,
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      stepId: params.stepId,
      attempt: params.attempt,
      logOutcome: params.logOutcome,
    },
  });
}

async function getStepAttemptTerminatedOutboxIdentity(
  tx: Tx,
  jobId: string,
): Promise<{runId: string; workspaceId: string; projectId: string}> {
  const rows = await tx
    .select({
      runId: jobs.runId,
      workspaceId: workflowRuns.workspaceId,
      projectId: workflowRuns.projectId,
    })
    .from(jobs)
    .innerJoin(workflowRuns, eq(jobs.runId, workflowRuns.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  const identity = rows[0];
  if (!identity) {
    throw new Error(`Cannot enqueue step-attempt-terminated event: job ${jobId} not found`);
  }

  return identity;
}

export interface TerminalStepAttemptLogState {
  jobId: string;
  runId: string;
  workspaceId: string;
  projectId: string;
  stepId: string;
  attempt: number;
  logOutcome: LogOutcomeDto;
}

export async function getTerminalStepAttemptLogState(params: {
  stepId: string;
  attempt: number;
}): Promise<TerminalStepAttemptLogState | undefined> {
  const rows = await db()
    .select({
      jobId: stepAttempts.jobId,
      runId: jobs.runId,
      workspaceId: workflowRuns.workspaceId,
      projectId: workflowRuns.projectId,
      stepId: stepAttempts.stepId,
      attempt: stepAttempts.attempt,
      logOutcome: stepAttempts.logOutcome,
    })
    .from(stepAttempts)
    .innerJoin(jobs, eq(stepAttempts.jobId, jobs.id))
    .innerJoin(workflowRuns, eq(jobs.runId, workflowRuns.id))
    .where(
      and(
        eq(stepAttempts.stepId, params.stepId),
        eq(stepAttempts.attempt, params.attempt),
        sql`${stepAttempts.status} <> 'running'`,
        sql`${stepAttempts.logOutcome} IS NOT NULL`,
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row?.logOutcome) return undefined;
  return {
    jobId: row.jobId,
    runId: row.runId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    stepId: row.stepId,
    attempt: row.attempt,
    logOutcome: row.logOutcome,
  };
}

export interface RewindStepsToPendingParams {
  executionId: string;
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
    .where(
      and(eq(steps.executionId, params.executionId), gte(steps.position, params.fromPosition)),
    );
}

// Enqueue the durable audit record of a restart, in the same transaction as the
// rewind. Looks up the run id like writeJobStepsSettledOutbox.
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
    .orderBy(asc(stepAttempts.executionOrder));
  return rows.map(toStepAttempt);
}

export async function getStepAttemptsByJobIds(jobIds: string[]): Promise<StepAttempt[]> {
  if (jobIds.length === 0) return [];
  const rows = await db()
    .select()
    .from(stepAttempts)
    .where(inArray(stepAttempts.jobId, jobIds))
    .orderBy(asc(stepAttempts.jobId), asc(stepAttempts.executionOrder));
  return rows.map(toStepAttempt);
}

export interface ApplyStepResultParams {
  executionId: string;
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
        eq(steps.executionId, params.executionId),
        sql`${steps.status} NOT IN ('succeeded','failed','cancelled')`,
      ),
    );
}

export interface CancelRemainingStepsParams {
  executionId: string;
}

// The just-failed step is already terminal, so the shared guarded sweep leaves
// it alone and only the still-pending siblings are cancelled.
export async function cancelRemainingSteps(
  params: CancelRemainingStepsParams,
  tx: Tx,
): Promise<void> {
  await bulkUpdateStepStatuses({executionId: params.executionId, status: 'cancelled'}, tx);
}
