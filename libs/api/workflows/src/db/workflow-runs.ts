import {
  type AgentDefaultsResolver,
  catalogDefaultAgentResolver,
} from '@shipfox/api-agent/core/resolve-agent-config';
import {DEFAULT_JOB_SUCCESS, type WorkflowModel} from '@shipfox/api-definitions';
import {getVariablesByNamespace} from '@shipfox/api-secrets';
import {
  type LogOutcomeDto,
  WORKFLOWS_JOB_EXECUTION_TIMED_OUT,
  WORKFLOWS_JOB_STEPS_SETTLED,
  WORKFLOWS_JOB_TERMINATED,
  WORKFLOWS_STEP_ATTEMPT_TERMINATED,
  WORKFLOWS_STEP_RESTART_ENQUEUED,
  WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
  WORKFLOWS_WORKFLOW_RUN_CANCELLED,
  WORKFLOWS_WORKFLOW_RUN_TERMINATED,
} from '@shipfox/api-workflows-dto';
import {
  analyzeContextKeyAccess,
  createWorkflowExpression,
  evaluateWorkflowPredicate,
  type ResolvedFieldSegment,
  WorkflowExpressionEvaluationError,
} from '@shipfox/expression';
import {
  paginateTimestampIdRows,
  type TimestampIdCursor,
  timestampIdCursorWhere,
} from '@shipfox/node-drizzle';
import {logger} from '@shipfox/node-opentelemetry';
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
  type SQL,
  sql,
} from 'drizzle-orm';
import {isJobTerminal, type Job, type JobStatus, type JobStatusReason} from '#core/entities/job.js';
import type {JobExecution, JobExecutionStatus} from '#core/entities/job-execution.js';
import type {Step, StepAttempt, StepAttemptStatus, StepStatus} from '#core/entities/step.js';
import {
  isWorkflowRunTerminal,
  type JobExecutionDetail,
  type StepDetail,
  type TriggerPayload,
  type WorkflowJobDetail,
  type WorkflowRun,
  type WorkflowRunDetail,
  type WorkflowRunStatus,
  type WorkflowSourceSnapshot,
} from '#core/entities/workflow-run.js';
import {
  InterpolationUnresolvableError,
  JobNotFoundError,
  NoFailedJobsError,
  RunNotTerminalError,
  SourceRunNotFoundError,
  WorkflowRunNotCancellableError,
  WorkflowRunNotFoundError,
} from '#core/errors.js';
import {
  assembleCreationContext,
  assembleExecutionCreationContext,
  assembleExecutionResolutionContext,
  assembleExecutionsContext,
  assembleJobsContext,
  type JobContextInput,
} from '#core/step-config/assemble-run-context.js';
import type {MaterializedWorkflowJob} from '#core/step-config/materialize-workflow-model.js';
import {
  materializeJobOutputs,
  materializeJobRunner,
  materializeWorkflowModel,
} from '#core/step-config/materialize-workflow-model.js';
import {resolveJobExecutionName} from '#core/step-config/resolve-job-execution-name.js';
import type {WorkflowStepTemplateDiagnostic} from '#core/step-config/resolve-step-config.js';
import {deriveCompletion, isTerminal} from '#core/step-transition/decide-step-transition.js';
import type {RuntimeCompletionStatus} from '#core/workflow-scheduling/runtime-dag.js';
import {
  recordWorkflowJobExecutionLeaseExpiryResolved,
  recordWorkflowJobExecutionQueued,
  recordWorkflowJobExecutionStarted,
  recordWorkflowJobExecutionStatusChanged,
  recordWorkflowJobExecutionTimedOut,
  recordWorkflowJobStatusChanged,
  recordWorkflowRunCreated,
  recordWorkflowRunStatusChanged,
} from '#metrics/instance.js';
import {db, type Tx} from './db.js';
import {writeWorkflowsOutboxEvent, writeWorkflowsOutboxEvents} from './outbox-writes.js';
import {runningJobExecutions} from './runner-lease-table.js';
import {jobExecutions, toJobExecution} from './schema/job-executions.js';
import {jobs, toJob} from './schema/jobs.js';
import {stepAttempts, toStepAttempt} from './schema/step-attempts.js';
import {steps, toStep} from './schema/steps.js';
import {toWorkflowRunAttempt, workflowRunAttempts} from './schema/workflow-run-attempts.js';
import {toWorkflowRun, workflowRuns} from './schema/workflow-runs.js';

const TERMINAL_WORKFLOW_RUN_STATUSES: WorkflowRunStatus[] = ['succeeded', 'failed', 'cancelled'];
const TERMINAL_JOB_STATUSES: JobStatus[] = ['succeeded', 'failed', 'cancelled', 'skipped'];
const TERMINAL_EXECUTION_STATUSES: JobExecutionStatus[] = ['succeeded', 'failed', 'cancelled'];

type WorkflowModelJob = WorkflowModel['jobs'][number];

interface ReferencedVariable {
  readonly key: string;
  readonly field: InterpolationUnresolvableError['field'];
  readonly source: string;
  readonly envKey?: string | undefined;
}

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
        currentAttempt: 1,
        triggerProvider: params.triggerPayload.provider ?? null,
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
    const [attemptRow] = await tx
      .insert(workflowRunAttempts)
      .values({
        workflowRunId: runRow.id,
        attempt: 1,
        status: 'pending',
        model: params.model,
      })
      .returning();
    if (!attemptRow) throw new Error('Insert returned no rows');

    // Resolving one-shot templates here gives interpolation access to the inserted run id.
    // If resolution fails, the transaction rolls back the run, jobs, steps, and outbox event together.
    // Listening steps are resolved later when a job execution is created.
    const oneShotJobs = params.model.jobs.filter((job) => job.mode !== 'listening');
    const context = assembleCreationContext({
      run,
      triggerPayload: params.triggerPayload,
      inputs: params.inputs ?? null,
      vars: await loadReferencedVariables({
        model: params.model,
        jobs: oneShotJobs,
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        definitionId: params.definitionId,
      }),
    });
    const materializedJobs = materializeWorkflowModel({
      model: params.model,
      context,
      resolveAgentDefaults: params.resolveAgentDefaults ?? catalogDefaultAgentResolver,
      definitionId: params.definitionId,
    });

    let jobRows: (typeof jobs.$inferSelect)[] = [];

    if (materializedJobs.length > 0) {
      jobRows = await tx
        .insert(jobs)
        .values(
          materializedJobs.map((job) => ({
            workflowRunAttemptId: attemptRow.id,
            key: job.key,
            mode: job.mode,
            name: workflowTemplateSource(job.name),
            status: 'pending' as const,
            checkoutPersistCredentials: job.checkout.persistCredentials,
            checkoutPermissionsContents: job.checkout.permissions.contents,
            success: job.success ?? null,
            executionTimeoutMs: job.executionTimeoutMs ?? null,
            listeningTimeoutMs: job.listening?.timeoutMs ?? null,
            maxExecutions: job.listening?.maxExecutions ?? null,
            onResolve: job.listening?.onResolve ?? null,
            batchDebounceMs: job.listening?.batch?.debounceMs ?? null,
            batchMaxSize: job.listening?.batch?.maxSize ?? null,
            batchMaxWaitMs: job.listening?.batch?.maxWaitMs ?? null,
            listeningOn: job.listening?.on ? [...job.listening.on] : null,
            listeningUntil: job.listening?.until ? [...job.listening.until] : null,
            dependencies: [...job.dependencies],
            runner: job.runner.length === 0 ? null : [...job.runner],
            position: job.position,
          })),
        )
        .returning();
    }

    const jobExecutionValues = jobRows.flatMap((jobRow, jobIndex) => {
      if (jobRow.mode === 'listening') return [];
      const job = materializedJobs[jobIndex];
      if (!job) return [];

      const fallbackName = `${jobRow.key} #1`;
      const context = assembleExecutionCreationContext({
        run,
        triggerPayload: params.triggerPayload,
        inputs: params.inputs ?? null,
        jobId: jobRow.id,
        sequence: 1,
        executionName: fallbackName,
        status: 'pending',
        triggerEvents: [],
        priorExecutions: [],
      });
      const name = resolveJobExecutionName({
        definitionId: params.definitionId,
        job,
        fallbackName,
        context: context.values,
      });
      const modelJob = params.model.jobs[jobIndex];
      if (!modelJob) return [];
      const runnerContext = assembleExecutionCreationContext({
        run,
        triggerPayload: params.triggerPayload,
        inputs: params.inputs ?? null,
        jobId: jobRow.id,
        sequence: 1,
        executionName: name,
        status: 'pending',
        triggerEvents: [],
        priorExecutions: [],
      });
      const runner = materializeJobRunner({
        job: modelJob,
        context: runnerContext,
        definitionId: params.definitionId,
      });

      return [
        {
          jobId: jobRow.id,
          sequence: 1,
          name,
          runner: [...runner],
          status: 'pending' as const,
        },
      ];
    });
    const jobExecutionRows =
      jobExecutionValues.length === 0
        ? []
        : await tx.insert(jobExecutions).values(jobExecutionValues).returning();

    const jobExecutionByJobId = new Map(
      jobExecutionRows.map((jobExecution) => [jobExecution.jobId, jobExecution]),
    );

    const stepValues: (typeof steps.$inferInsert)[] = [];
    for (const [jobIndex, jobRow] of jobRows.entries()) {
      const job = materializedJobs[jobIndex];
      const jobExecution = jobExecutionByJobId.get(jobRow.id);
      if (!jobExecution) continue;
      if (!job) continue;
      for (const step of job.steps) {
        stepValues.push({
          jobExecutionId: jobExecution.id,
          key: step.key,
          name: step.name,
          sourceLocation: step.sourceLocation,
          status: step.status,
          type: step.type,
          config: step.config,
          configPlan: step.configPlan ?? null,
          authoredConfig: step.authoredConfig,
          position: step.position,
        });
      }
    }

    if (stepValues.length > 0) {
      await tx.insert(steps).values(stepValues);
    }

    await writeWorkflowsOutboxEvent(tx, {
      type: WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
      payload: {
        workflowRunId: runRow.id,
        workflowRunAttemptId: attemptRow.id,
        attempt: attemptRow.attempt,
        workspaceId: runRow.workspaceId,
        projectId: runRow.projectId,
        definitionId: runRow.definitionId,
      },
    });

    logTemplateDiagnostics({
      workflowRunId: runRow.id,
      diagnostics: materializedJobs.flatMap((job) =>
        job.steps.flatMap((step) =>
          (step.diagnostics ?? []).map((diagnostic) => ({
            jobKey: job.key,
            stepName: step.name,
            ...diagnostic,
          })),
        ),
      ),
    });

    return {run, created: true};
  });

  if (result.created)
    recordWorkflowRunCreated(result.run.triggerPayload.provider ?? result.run.triggerSource);

  return result.run;
}

async function loadReferencedVariables(params: {
  readonly model: WorkflowModel;
  readonly jobs?: readonly WorkflowModelJob[] | undefined;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly definitionId: string;
}): Promise<Record<string, string> | undefined> {
  const references = referencedVariables(params.model, params.jobs ?? params.model.jobs);
  const keys = [...new Set(references.map((reference) => reference.key))].sort();
  if (keys.length === 0) return undefined;

  const vars = await getVariablesByNamespace({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    namespace: '',
  });
  const missingKey = keys.find((key) => !(key in vars));
  if (missingKey !== undefined) {
    const reference = references.find((candidate) => candidate.key === missingKey);
    throw new InterpolationUnresolvableError(params.definitionId, {
      field: reference?.field ?? 'env',
      source: reference?.source ?? `vars.${missingKey}`,
      ...(reference?.envKey === undefined ? {} : {envKey: reference.envKey}),
    });
  }

  return vars;
}

function referencedVariables(
  model: WorkflowModel,
  jobs: readonly WorkflowModelJob[],
): readonly ReferencedVariable[] {
  const references: ReferencedVariable[] = [];

  if (jobs.length > 0) {
    collectTemplateVariableReferences(model.templates?.env, references);
  }

  for (const job of jobs) {
    collectFieldVariableReferences(job.name, references, {field: 'job.name'});
    collectTemplateVariableReferences(job.outputs, references, {field: 'job.outputs'});
    collectTemplateVariableReferences(job.templates?.env, references);

    for (const step of job.steps) {
      collectFieldVariableReferences(step.templates?.name, references, {field: 'step.name'});
      if (step.kind === 'run') {
        collectFieldVariableReferences(step.templates?.command, references, {field: 'run'});
        collectTemplateVariableReferences(step.templates?.env, references);
      } else {
        collectFieldVariableReferences(step.templates?.prompt, references, {field: 'agent.prompt'});
        collectFieldVariableReferences(step.templates?.model, references, {field: 'agent.model'});
        collectFieldVariableReferences(step.templates?.provider, references, {
          field: 'agent.provider',
        });
      }
    }
  }

  return references;
}

function collectTemplateVariableReferences(
  templates: Readonly<Record<string, readonly ResolvedFieldSegment[]>> | undefined,
  references: ReferencedVariable[],
  source?: {
    readonly field: InterpolationUnresolvableError['field'];
  },
): void {
  for (const [envKey, template] of Object.entries(templates ?? {})) {
    collectFieldVariableReferences(
      template,
      references,
      source === undefined ? {field: 'env', envKey} : source,
    );
  }
}

function collectFieldVariableReferences(
  template: readonly ResolvedFieldSegment[] | undefined,
  references: ReferencedVariable[],
  source: {
    readonly field: InterpolationUnresolvableError['field'];
    readonly envKey?: string | undefined;
  },
): void {
  for (const segment of template ?? []) {
    if (segment.kind === 'literal') continue;
    const keyAccess = analyzeContextKeyAccess(segment.expression);
    for (const reference of keyAccess.references) {
      if (reference.root !== 'vars') continue;
      references.push({
        key: reference.key,
        field: source.field,
        source: segment.expression.source,
        envKey: source.envKey,
      });
    }
  }
}

export async function getStepByIdForJobExecution(params: {
  stepId: string;
  jobExecutionId: string;
}): Promise<Step | undefined> {
  const rows = await db()
    .select()
    .from(steps)
    .where(and(eq(steps.id, params.stepId), eq(steps.jobExecutionId, params.jobExecutionId)))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toStep(row);
}

export async function lockActiveJobExecutionLeaseForUpdate(
  params: {jobId: string; jobExecutionId: string; runnerSessionId: string},
  tx: Tx,
): Promise<boolean> {
  const rows = await tx
    .select({id: runningJobExecutions.id})
    .from(runningJobExecutions)
    .where(
      and(
        eq(runningJobExecutions.jobId, params.jobId),
        eq(runningJobExecutions.jobExecutionId, params.jobExecutionId),
        eq(runningJobExecutions.runnerSessionId, params.runnerSessionId),
      ),
    )
    .limit(1)
    .for('update');

  return rows.length > 0;
}

export interface CreateRerunWorkflowRunParams {
  workflowRunId: string;
  mode: 'all' | 'failed';
  actorUserId: string;
}

export async function createRerunWorkflowRun(
  params: CreateRerunWorkflowRunParams,
): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const workflowRunId = params.workflowRunId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workflowRunId}))`);

    const sourceRows = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, workflowRunId))
      .limit(1)
      .for('update');
    const sourceRow = sourceRows[0];
    if (!sourceRow) throw new SourceRunNotFoundError(workflowRunId);

    const [sourceAttemptRow] = await tx
      .select()
      .from(workflowRunAttempts)
      .where(
        and(
          eq(workflowRunAttempts.workflowRunId, sourceRow.id),
          eq(workflowRunAttempts.attempt, sourceRow.currentAttempt),
        ),
      )
      .limit(1)
      .for('update');
    if (!sourceAttemptRow) {
      throw new Error(
        `Current attempt ${sourceRow.currentAttempt} missing for run ${sourceRow.id}`,
      );
    }
    if (!isWorkflowRunTerminal(sourceAttemptRow.status)) {
      throw new RunNotTerminalError(sourceRow.id);
    }

    const sourceJobs = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.workflowRunAttemptId, sourceAttemptRow.id))
      .orderBy(asc(jobs.position), asc(jobs.id));

    if (
      params.mode === 'failed' &&
      !sourceJobs.some((job) => job.status === 'failed' || job.status === 'cancelled')
    ) {
      throw new NoFailedJobsError(sourceRow.id);
    }

    const [attemptRow] = await tx
      .select({value: sql<number>`coalesce(max(${workflowRunAttempts.attempt}), 1)`})
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.workflowRunId, sourceRow.id));
    const attempt = Number(attemptRow?.value ?? 1) + 1;

    const [newAttemptRow] = await tx
      .insert(workflowRunAttempts)
      .values({
        workflowRunId: sourceRow.id,
        attempt,
        status: 'pending',
        rerunMode: params.mode,
        rerunByUserId: params.actorUserId,
        model: sourceAttemptRow.model,
      })
      .returning();
    if (!newAttemptRow) throw new Error('Insert returned no rows');

    const sourceJobIds = sourceJobs.map((job) => job.id);
    const sourceJobExecutionRows =
      sourceJobIds.length === 0
        ? []
        : await tx
            .select()
            .from(jobExecutions)
            .where(inArray(jobExecutions.jobId, sourceJobIds))
            .orderBy(asc(jobExecutions.jobId), asc(jobExecutions.sequence), asc(jobExecutions.id));
    const sourceJobExecutionByJobId = new Map<string, (typeof sourceJobExecutionRows)[number]>();
    for (const jobExecution of sourceJobExecutionRows) {
      if (!sourceJobExecutionByJobId.has(jobExecution.jobId)) {
        sourceJobExecutionByJobId.set(jobExecution.jobId, jobExecution);
      }
    }
    const sourceJobExecutionIds = [...sourceJobExecutionByJobId.values()].map(
      (jobExecution) => jobExecution.id,
    );
    const sourceSteps =
      sourceJobExecutionIds.length === 0
        ? []
        : await tx
            .select()
            .from(steps)
            .where(inArray(steps.jobExecutionId, sourceJobExecutionIds))
            .orderBy(asc(steps.jobExecutionId), asc(steps.position), asc(steps.id));

    const clonedJobRows =
      sourceJobs.length === 0
        ? []
        : await tx
            .insert(jobs)
            .values(
              sourceJobs.map((job) => {
                const carriedOver = params.mode === 'failed' && job.status === 'succeeded';
                return {
                  workflowRunAttemptId: newAttemptRow.id,
                  key: job.key,
                  name: job.name,
                  mode: job.mode,
                  status: carriedOver ? ('succeeded' as const) : ('pending' as const),
                  statusReason: null,
                  carriedOver,
                  checkoutPersistCredentials: job.checkoutPersistCredentials,
                  checkoutPermissionsContents: job.checkoutPermissionsContents,
                  success: job.success,
                  executionTimeoutMs: job.executionTimeoutMs,
                  listeningTimeoutMs: job.listeningTimeoutMs,
                  maxExecutions: job.maxExecutions,
                  onResolve: job.onResolve,
                  batchDebounceMs: job.batchDebounceMs,
                  batchMaxSize: job.batchMaxSize,
                  batchMaxWaitMs: job.batchMaxWaitMs,
                  listenerStatus: 'inactive' as const,
                  resolutionReason: null,
                  listeningOn: job.listeningOn ? [...job.listeningOn] : null,
                  listeningUntil: job.listeningUntil ? [...job.listeningUntil] : null,
                  outputs: job.outputs ? {...job.outputs} : null,
                  dependencies: [...job.dependencies],
                  runner: job.runner ? [...job.runner] : null,
                  position: job.position,
                };
              }),
            )
            .returning();

    const sourceJobByPosition = new Map(sourceJobs.map((job) => [job.position, job]));
    const sourceModelJobByKey = new Map(
      (sourceAttemptRow.model?.jobs ?? []).map((job) => [job.key, job]),
    );
    const clonedJobExecutionValues = clonedJobRows.flatMap((job) => {
      const carriedOver = params.mode === 'failed' && job.status === 'succeeded';
      const sourceJob = sourceJobByPosition.get(job.position);
      const sourceExecution = sourceJob ? sourceJobExecutionByJobId.get(sourceJob.id) : undefined;
      const modelJob = sourceModelJobByKey.get(job.key);
      const executionName = sourceExecution?.name ?? `${job.key} #1`;
      const runner =
        carriedOver || modelJob === undefined
          ? (sourceExecution?.runner ?? job.runner ?? null)
          : materializeJobRunner({
              job: modelJob,
              context: assembleExecutionCreationContext({
                run: toWorkflowRun(sourceRow),
                triggerPayload: sourceRow.triggerPayload,
                inputs: sourceRow.inputs,
                jobId: job.id,
                sequence: 1,
                executionName,
                status: 'pending',
                triggerEvents: [],
                priorExecutions: [],
              }),
              definitionId: sourceRow.definitionId,
            });
      return job.mode === 'listening'
        ? []
        : [
            {
              jobId: job.id,
              sequence: 1,
              name: executionName,
              runner: runner ? [...runner] : null,
              status: carriedOver ? ('succeeded' as const) : ('pending' as const),
              statusReason: null,
              outputs:
                carriedOver && sourceExecution?.outputs ? {...sourceExecution.outputs} : null,
              ...(carriedOver ? {finishedAt: sql`now()`} : {}),
            },
          ];
    });
    const clonedJobExecutionRows =
      clonedJobExecutionValues.length === 0
        ? []
        : await tx.insert(jobExecutions).values(clonedJobExecutionValues).returning();

    const sourceJobById = new Map(sourceJobs.map((job) => [job.id, job]));
    const sourceJobByJobExecutionId = new Map(
      [...sourceJobExecutionByJobId.entries()].flatMap(([jobId, jobExecution]) => {
        const job = sourceJobById.get(jobId);
        return job ? [[jobExecution.id, job] as const] : [];
      }),
    );
    const clonedJobByPosition = new Map(clonedJobRows.map((job) => [job.position, job]));
    const clonedJobExecutionByJobId = new Map(
      clonedJobExecutionRows.map((jobExecution) => [jobExecution.jobId, jobExecution]),
    );
    const stepValues = sourceSteps.flatMap((step) => {
      const sourceJob = sourceJobByJobExecutionId.get(step.jobExecutionId);
      if (!sourceJob) return [];
      const clonedJob = clonedJobByPosition.get(sourceJob.position);
      if (!clonedJob) return [];
      const clonedJobExecution = clonedJobExecutionByJobId.get(clonedJob.id);
      if (!clonedJobExecution) return [];
      const carriedOver = params.mode === 'failed' && sourceJob.status === 'succeeded';
      return [
        {
          jobExecutionId: clonedJobExecution.id,
          key: step.key,
          name: step.name,
          sourceLocation: step.sourceLocation,
          status: carriedOver ? step.status : ('pending' as const),
          type: step.type,
          config: step.config,
          configPlan: step.configPlan,
          authoredConfig: step.authoredConfig,
          error: null,
          position: step.position,
          currentAttempt: 1,
        },
      ];
    });

    if (stepValues.length > 0) {
      await tx.insert(steps).values(stepValues);
    }

    const [newRunRow] = await tx
      .update(workflowRuns)
      .set({
        currentAttempt: attempt,
        status: 'pending',
        version: sql`${workflowRuns.version} + 1`,
        updatedAt: new Date(),
        startedAt: null,
        finishedAt: null,
      })
      .where(eq(workflowRuns.id, sourceRow.id))
      .returning();
    if (!newRunRow) throw new Error(`Workflow run missing after rerun: ${sourceRow.id}`);

    await writeWorkflowsOutboxEvent(tx, {
      type: WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
      payload: {
        workflowRunId: newRunRow.id,
        workflowRunAttemptId: newAttemptRow.id,
        attempt: newAttemptRow.attempt,
        workspaceId: newRunRow.workspaceId,
        projectId: newRunRow.projectId,
        definitionId: newRunRow.definitionId,
      },
    });

    return toWorkflowRun(newRunRow);
  });

  recordWorkflowRunCreated(result.triggerPayload.provider ?? result.triggerSource);

  return result;
}

function workflowTemplateSource(template: MaterializedWorkflowJob['name']): string | null {
  if (template === undefined) return null;

  return template
    .map((segment) =>
      segment.kind === 'literal' ? segment.value : `$${'{{'} ${segment.expression.source} ${'}}'}`,
    )
    .join('');
}

function logTemplateDiagnostics(params: {
  readonly workflowRunId: string;
  readonly diagnostics: readonly (WorkflowStepTemplateDiagnostic & {
    readonly jobKey: string;
    readonly stepName: string;
  })[];
}): void {
  if (params.diagnostics.length === 0) return;

  logger().warn(
    {workflowRunId: params.workflowRunId, diagnostics: params.diagnostics},
    'Workflow interpolation resolved with diagnostics',
  );
}

export async function getWorkflowRunById(id: string): Promise<WorkflowRun | undefined> {
  const rows = await db().select().from(workflowRuns).where(eq(workflowRuns.id, id)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toWorkflowRun(row);
}

export async function getWorkflowRunByAttemptId(
  workflowRunAttemptId: string,
): Promise<WorkflowRun | undefined> {
  const rows = await db()
    .select({run: workflowRuns})
    .from(workflowRunAttempts)
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(workflowRunAttempts.id, workflowRunAttemptId))
    .limit(1);
  const row = rows[0];
  return row ? toWorkflowRun(row.run) : undefined;
}

export async function getWorkflowRunAttemptById(workflowRunAttemptId: string) {
  const rows = await db()
    .select()
    .from(workflowRunAttempts)
    .where(eq(workflowRunAttempts.id, workflowRunAttemptId))
    .limit(1);
  const row = rows[0];
  return row ? toWorkflowRunAttempt(row) : undefined;
}

export async function listRunAttempts(params: {workflowRunId: string; projectId: string}) {
  return (
    await db()
      .select({
        attempt: workflowRunAttempts,
      })
      .from(workflowRunAttempts)
      .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
      .where(
        and(
          eq(workflowRunAttempts.workflowRunId, params.workflowRunId),
          eq(workflowRuns.projectId, params.projectId),
        ),
      )
      .orderBy(asc(workflowRunAttempts.attempt))
  ).map((row) => toWorkflowRunAttempt(row.attempt));
}

export async function getLatestAttempt(params: {
  workflowRunId: string;
  projectId: string;
}): Promise<number> {
  const [row] = await db()
    .select({value: sql<number>`coalesce(max(${workflowRunAttempts.attempt}), 1)`})
    .from(workflowRunAttempts)
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(
      and(
        eq(workflowRunAttempts.workflowRunId, params.workflowRunId),
        eq(workflowRuns.projectId, params.projectId),
      ),
    )
    .limit(1);

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

export interface WorkflowJobExecutionDepth {
  runningRuns: number;
  runningJobExecutions: number;
}

export interface WorkflowJobExecutionDepthParams {
  workspaceId?: string;
}

export async function getWorkflowJobExecutionDepth(
  params: WorkflowJobExecutionDepthParams = {},
): Promise<WorkflowJobExecutionDepth> {
  const runConditions = [eq(workflowRuns.status, 'running')];
  const jobConditions = [eq(jobExecutions.status, 'running')];
  if (params.workspaceId) {
    runConditions.push(eq(workflowRuns.workspaceId, params.workspaceId));
    jobConditions.push(eq(workflowRuns.workspaceId, params.workspaceId));
  }

  const [runRows, jobRows] = await Promise.all([
    db()
      .select({value: count()})
      .from(workflowRuns)
      .where(and(...runConditions)),
    db()
      .select({value: count()})
      .from(jobExecutions)
      .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
      .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
      .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
      .where(and(...jobConditions)),
  ]);

  return {
    runningRuns: runRows[0]?.value ?? 0,
    runningJobExecutions: jobRows[0]?.value ?? 0,
  };
}

export async function getJobsByWorkflowRunAttemptId(workflowRunAttemptId: string): Promise<Job[]> {
  const rows = await db()
    .select()
    .from(jobs)
    .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId))
    .orderBy(asc(jobs.position));
  return rows.map(toJob);
}

export async function getJobsByWorkflowRunId(workflowRunId: string): Promise<Job[]> {
  const run = await getWorkflowRunById(workflowRunId);
  if (!run) return [];
  const [attempt] = await db()
    .select()
    .from(workflowRunAttempts)
    .where(
      and(
        eq(workflowRunAttempts.workflowRunId, run.id),
        eq(workflowRunAttempts.attempt, run.currentAttempt),
      ),
    )
    .limit(1);
  return attempt ? getJobsByWorkflowRunAttemptId(attempt.id) : [];
}

export async function getJobById(id: string): Promise<Job | undefined> {
  const rows = await db().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toJob(row);
}

export async function getJobExecutionById(id: string, tx?: Tx): Promise<JobExecution | undefined> {
  const rows = await (tx ?? db())
    .select()
    .from(jobExecutions)
    .where(eq(jobExecutions.id, id))
    .limit(1);
  const row = rows[0];
  return row ? toJobExecution(row) : undefined;
}

export async function getDirectDependencyJobContexts(
  jobId: string,
  tx?: Tx,
): Promise<JobContextInput[]> {
  const targetRows = await (tx ?? db()).select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const target = targetRows[0];
  if (!target || target.dependencies.length === 0) return [];

  const rows = await (tx ?? db())
    .select({job: jobs, execution: jobExecutions})
    .from(jobs)
    .leftJoin(jobExecutions, eq(jobExecutions.jobId, jobs.id))
    .where(
      and(
        eq(jobs.workflowRunAttemptId, target.workflowRunAttemptId),
        inArray(jobs.key, target.dependencies),
      ),
    )
    .orderBy(asc(jobs.position), asc(jobs.id), asc(jobExecutions.sequence), asc(jobExecutions.id));

  const contextsByJobId = new Map<string, JobContextInput & {executions: JobExecution[]}>();
  for (const row of rows) {
    let context = contextsByJobId.get(row.job.id);
    if (!context) {
      context = {job: toJob(row.job), executions: []};
      contextsByJobId.set(row.job.id, context);
    }
    if (row.execution) context.executions.push(toJobExecution(row.execution));
  }

  return [...contextsByJobId.values()];
}

export async function getWorkflowRunDetail(
  workflowRunId: string,
  attempt?: number | undefined,
): Promise<WorkflowRunDetail | undefined> {
  const [target] = await db()
    .select({run: workflowRuns, attempt: workflowRunAttempts})
    .from(workflowRuns)
    .innerJoin(
      workflowRunAttempts,
      and(
        eq(workflowRunAttempts.workflowRunId, workflowRuns.id),
        eq(workflowRunAttempts.attempt, attempt ?? workflowRuns.currentAttempt),
      ),
    )
    .where(eq(workflowRuns.id, workflowRunId))
    .limit(1);
  if (!target) return undefined;

  const latestAttempt = await getLatestAttempt({
    workflowRunId: target.run.id,
    projectId: target.run.projectId,
  });

  const rows = await db()
    .select({
      run: workflowRuns,
      attemptId: workflowRunAttempts.id,
      job: jobs,
      jobExecution: jobExecutions,
      step: steps,
      stepAttempt: stepAttempts,
    })
    .from(workflowRuns)
    .innerJoin(workflowRunAttempts, eq(workflowRunAttempts.id, target.attempt.id))
    .leftJoin(jobs, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .leftJoin(jobExecutions, eq(jobExecutions.jobId, jobs.id))
    .leftJoin(steps, eq(steps.jobExecutionId, jobExecutions.id))
    .leftJoin(stepAttempts, eq(stepAttempts.stepId, steps.id))
    .where(eq(workflowRuns.id, workflowRunId))
    .orderBy(
      asc(jobs.position),
      asc(jobs.id),
      asc(jobExecutions.sequence),
      asc(jobExecutions.id),
      asc(steps.position),
      asc(steps.id),
      asc(stepAttempts.executionOrder),
      asc(stepAttempts.id),
    );

  return hydrateWorkflowRunDetail(rows, target.attempt, latestAttempt);
}

export async function getJobExecutionDetail(
  jobExecutionId: string,
): Promise<JobExecutionDetail | undefined> {
  const rows = await db()
    .select({
      jobExecution: jobExecutions,
      step: steps,
      stepAttempt: stepAttempts,
    })
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .leftJoin(steps, eq(steps.jobExecutionId, jobExecutions.id))
    .leftJoin(stepAttempts, eq(stepAttempts.stepId, steps.id))
    .where(eq(jobExecutions.id, jobExecutionId))
    .orderBy(
      asc(steps.position),
      asc(steps.id),
      asc(stepAttempts.executionOrder),
      asc(stepAttempts.id),
    );

  const first = rows[0];
  if (!first) return undefined;

  const detail: JobExecutionDetail = {...toJobExecution(first.jobExecution), steps: []};
  const stepById = new Map<string, StepDetail>();
  for (const row of rows) {
    if (row.step) {
      const step = getOrCreateStepDetail(stepById, detail.steps, row.step);
      if (row.stepAttempt) {
        step.attempts.push(toStepAttempt(row.stepAttempt));
      }
    }
  }

  return detail;
}

function hydrateWorkflowRunDetail(
  rows: {
    run: typeof workflowRuns.$inferSelect;
    attemptId: string;
    job: typeof jobs.$inferSelect | null;
    jobExecution: typeof jobExecutions.$inferSelect | null;
    step: typeof steps.$inferSelect | null;
    stepAttempt: typeof stepAttempts.$inferSelect | null;
  }[],
  attempt: typeof workflowRunAttempts.$inferSelect,
  latestAttempt: number,
): WorkflowRunDetail | undefined {
  const first = rows[0];
  if (!first) return undefined;

  const detail: WorkflowRunDetail = {
    ...toWorkflowRun(first.run),
    runAttempt: toWorkflowRunAttempt(attempt),
    latestAttempt,
    jobs: [],
  };
  const jobById = new Map<string, WorkflowJobDetail>();
  const jobExecutionById = new Map<string, JobExecutionDetail>();
  const stepById = new Map<string, StepDetail>();

  for (const row of rows) {
    if (!row.job) continue;
    let job = jobById.get(row.job.id);
    if (!job) {
      job = {...toJob(row.job), jobExecutions: []};
      jobById.set(row.job.id, job);
      detail.jobs.push(job);
    }

    if (!row.jobExecution) continue;
    let jobExecution = jobExecutionById.get(row.jobExecution.id);
    if (!jobExecution) {
      jobExecution = {...toJobExecution(row.jobExecution), steps: []};
      jobExecutionById.set(row.jobExecution.id, jobExecution);
      job.jobExecutions.push(jobExecution);
    }

    if (!row.step) continue;
    const step = getOrCreateStepDetail(stepById, jobExecution.steps, row.step);
    if (row.stepAttempt) {
      step.attempts.push(toStepAttempt(row.stepAttempt));
    }
  }

  return detail;
}

function getOrCreateStepDetail(
  stepById: Map<string, StepDetail>,
  target: StepDetail[],
  row: typeof steps.$inferSelect,
): StepDetail {
  let step = stepById.get(row.id);
  if (!step) {
    step = {...toStep(row), attempts: []};
    stepById.set(row.id, step);
    target.push(step);
  }
  return step;
}

export interface JobScope {
  workspaceId: string;
  projectId: string;
}

export async function getJobScope(jobId: string): Promise<JobScope | undefined> {
  const rows = await db()
    .select({workspaceId: workflowRuns.workspaceId, projectId: workflowRuns.projectId})
    .from(jobs)
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  return rows[0];
}

export async function getStepsByJobId(jobId: string): Promise<Step[]> {
  const rows = await db()
    .select({step: steps})
    .from(steps)
    .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(asc(steps.position));
  return rows.map((row) => toStep(row.step));
}

export async function getStepsByJobExecutionId(jobExecutionId: string): Promise<Step[]> {
  const rows = await db()
    .select()
    .from(steps)
    .where(eq(steps.jobExecutionId, jobExecutionId))
    .orderBy(asc(steps.position));
  return rows.map(toStep);
}

export async function getJobExecutionsByWorkflowRunAttemptId(
  workflowRunAttemptId: string,
): Promise<JobExecution[]> {
  const rows = await db()
    .select({jobExecution: jobExecutions})
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId))
    .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));
  return rows.map((row) => toJobExecution(row.jobExecution));
}

export async function getJobExecutionsByJobId(jobId: string): Promise<JobExecution[]> {
  const rows = await db()
    .select()
    .from(jobExecutions)
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));
  return rows.map(toJobExecution);
}

export async function getFirstJobExecutionByJobId(
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

export async function getLatestJobExecutionByJobId(
  jobId: string,
  tx?: Tx,
): Promise<JobExecution | undefined> {
  const rows = await (tx ?? db())
    .select()
    .from(jobExecutions)
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(desc(jobExecutions.sequence), desc(jobExecutions.id))
    .limit(1);
  const row = rows[0];
  return row ? toJobExecution(row) : undefined;
}

export interface CancelWorkflowRunParams {
  workflowRunId: string;
}

export interface FailWorkflowRunAsTimedOutParams {
  runAttemptId: string;
}

interface RunTerminationSpec {
  terminalStatus: Extract<WorkflowRunStatus, 'failed' | 'cancelled'>;
  statusReason: Extract<JobStatusReason, 'timed_out' | 'run_cancelled'>;
  markExecutionTimedOut: boolean;
  emitCancelledEvent: boolean;
}

/**
 * Shared terminal transition for a run attempt. The caller locks the run and the
 * attempt (and decides how an already-terminal run is handled: timeout returns
 * idempotently, cancellation rejects), then this drives every non-terminal job,
 * execution, and step to `spec.terminalStatus`, resolves still-listening jobs,
 * flips the attempt and run, and writes the outbox. Callers record metrics after
 * the transaction commits.
 */
async function terminateRunAttempt(
  tx: Tx,
  params: {
    lockedRun: typeof workflowRuns.$inferSelect;
    lockedAttempt: typeof workflowRunAttempts.$inferSelect;
    spec: RunTerminationSpec;
  },
): Promise<{run: WorkflowRun; changedJobs: Job[]}> {
  const {lockedRun, lockedAttempt, spec} = params;

  const runJobExecutionIds = tx
    .select({id: jobExecutions.id})
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(eq(jobs.workflowRunAttemptId, lockedAttempt.id));

  await tx
    .select({id: steps.id})
    .from(steps)
    .where(inArray(steps.jobExecutionId, runJobExecutionIds))
    .orderBy(asc(steps.jobExecutionId), asc(steps.position))
    .for('update');

  const jobRows = await tx
    .select()
    .from(jobs)
    .where(eq(jobs.workflowRunAttemptId, lockedAttempt.id))
    .orderBy(asc(jobs.position), asc(jobs.id))
    .for('update');

  const changedJobs: Job[] = [];
  for (const jobRow of jobRows) {
    if (isJobTerminal(jobRow.status)) continue;

    const updated = await updateJobStatusAtVersion(tx, {
      jobId: jobRow.id,
      status: spec.terminalStatus,
      expectedVersion: jobRow.version,
      statusReason: spec.statusReason,
    });
    if (updated?.changed) changedJobs.push(updated.job);

    if (jobRow.mode === 'listening') {
      await tx
        .update(jobs)
        .set({listenerStatus: 'resolved', resolutionReason: 'cancelled', updatedAt: new Date()})
        .where(eq(jobs.id, jobRow.id));
    }

    const terminatedExecutions = await tx
      .update(jobExecutions)
      .set({
        status: spec.terminalStatus,
        statusReason: spec.statusReason,
        version: sql`${jobExecutions.version} + 1`,
        updatedAt: new Date(),
        finishedAt: sql`now()`,
        ...(spec.markExecutionTimedOut ? {timedOutAt: sql`now()`} : {}),
      })
      .where(
        and(
          eq(jobExecutions.jobId, jobRow.id),
          notInArray(jobExecutions.status, TERMINAL_EXECUTION_STATUSES),
        ),
      )
      .returning({id: jobExecutions.id});
    for (const jobExecution of terminatedExecutions) {
      await bulkUpdateStepStatuses(
        {jobExecutionId: jobExecution.id, status: spec.terminalStatus},
        tx,
      );
    }
  }

  await tx
    .update(workflowRunAttempts)
    .set({
      status: spec.terminalStatus,
      version: sql`${workflowRunAttempts.version} + 1`,
      updatedAt: new Date(),
      finishedAt: sql`now()`,
    })
    .where(
      and(
        eq(workflowRunAttempts.id, lockedAttempt.id),
        notInArray(workflowRunAttempts.status, TERMINAL_WORKFLOW_RUN_STATUSES),
      ),
    );

  const [terminatedRunRow] = await tx
    .update(workflowRuns)
    .set({
      status: spec.terminalStatus,
      version: sql`${workflowRuns.version} + 1`,
      updatedAt: new Date(),
      finishedAt: sql`now()`,
    })
    .where(
      and(
        eq(workflowRuns.id, lockedRun.id),
        notInArray(workflowRuns.status, TERMINAL_WORKFLOW_RUN_STATUSES),
      ),
    )
    .returning();

  const run = toWorkflowRun(terminatedRunRow ?? lockedRun);
  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_WORKFLOW_RUN_TERMINATED,
    payload: {
      workflowRunId: run.id,
      workflowRunAttemptId: lockedAttempt.id,
      projectId: run.projectId,
      status: spec.terminalStatus,
    },
  });
  if (spec.emitCancelledEvent) {
    await writeWorkflowsOutboxEvent(tx, {
      type: WORKFLOWS_WORKFLOW_RUN_CANCELLED,
      payload: {
        workflowRunId: run.id,
        workflowRunAttemptId: lockedAttempt.id,
        projectId: run.projectId,
      },
    });
  }

  return {run, changedJobs};
}

export async function failWorkflowRunAsTimedOut(
  params: FailWorkflowRunAsTimedOutParams,
): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const [lockedAttempt] = await tx
      .select()
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.id, params.runAttemptId))
      .limit(1)
      .for('update');
    if (!lockedAttempt) throw new WorkflowRunNotFoundError(params.runAttemptId);

    const [lockedRun] = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, lockedAttempt.workflowRunId))
      .limit(1)
      .for('update');
    if (!lockedRun) throw new WorkflowRunNotFoundError(lockedAttempt.workflowRunId);
    if (isWorkflowRunTerminal(lockedRun.status)) {
      return {run: toWorkflowRun(lockedRun), changedJobs: []};
    }

    return terminateRunAttempt(tx, {
      lockedRun,
      lockedAttempt,
      spec: {
        terminalStatus: 'failed',
        statusReason: 'timed_out',
        markExecutionTimedOut: true,
        emitCancelledEvent: false,
      },
    });
  });

  recordWorkflowRunStatusChanged(result.run.status);
  for (const job of result.changedJobs) recordWorkflowJobStatusChanged(job.status);
  return result.run;
}

export async function cancelWorkflowRun(params: CancelWorkflowRunParams): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const [lockedRun] = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, params.workflowRunId))
      .limit(1)
      .for('update');

    if (!lockedRun) {
      throw new WorkflowRunNotFoundError(params.workflowRunId);
    }
    if (isWorkflowRunTerminal(lockedRun.status)) {
      throw new WorkflowRunNotCancellableError(lockedRun.id, lockedRun.status);
    }

    const [lockedAttempt] = await tx
      .select()
      .from(workflowRunAttempts)
      .where(
        and(
          eq(workflowRunAttempts.workflowRunId, lockedRun.id),
          eq(workflowRunAttempts.attempt, lockedRun.currentAttempt),
        ),
      )
      .limit(1)
      .for('update');
    if (!lockedAttempt) {
      throw new Error(
        `Current attempt ${lockedRun.currentAttempt} missing for run ${lockedRun.id}`,
      );
    }

    return terminateRunAttempt(tx, {
      lockedRun,
      lockedAttempt,
      spec: {
        terminalStatus: 'cancelled',
        statusReason: 'run_cancelled',
        markExecutionTimedOut: false,
        emitCancelledEvent: true,
      },
    });
  });

  recordWorkflowRunStatusChanged(result.run.status);
  for (const job of result.changedJobs) recordWorkflowJobStatusChanged(job.status);

  return result.run;
}

export interface UpdateWorkflowRunStatusParams {
  workflowRunId?: string;
  workflowRunAttemptId?: string;
  status: WorkflowRunStatus;
  expectedVersion: number;
}

export async function updateWorkflowRunStatus(
  params: UpdateWorkflowRunStatusParams,
): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const [attemptRef] = params.workflowRunAttemptId
      ? await tx
          .select({
            id: workflowRunAttempts.id,
            workflowRunId: workflowRunAttempts.workflowRunId,
          })
          .from(workflowRunAttempts)
          .where(eq(workflowRunAttempts.id, params.workflowRunAttemptId))
          .limit(1)
      : [];

    const workflowRunId = attemptRef?.workflowRunId ?? params.workflowRunId ?? '';
    const [lockedRun] = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, workflowRunId))
      .limit(1)
      .for('update');

    if (!lockedRun) {
      throw new WorkflowRunNotFoundError(params.workflowRunId ?? params.workflowRunAttemptId ?? '');
    }

    const [lockedAttempt] = await tx
      .select()
      .from(workflowRunAttempts)
      .where(
        params.workflowRunAttemptId
          ? eq(workflowRunAttempts.id, params.workflowRunAttemptId)
          : and(
              eq(workflowRunAttempts.workflowRunId, lockedRun.id),
              eq(workflowRunAttempts.attempt, lockedRun.currentAttempt),
            ),
      )
      .limit(1)
      .for('update');

    if (!lockedAttempt) {
      throw new WorkflowRunNotFoundError(params.workflowRunId ?? params.workflowRunAttemptId ?? '');
    }

    const target = {run: lockedRun, attempt: lockedAttempt};

    const rows = await tx
      .update(workflowRunAttempts)
      .set({
        status: params.status,
        version: sql`${workflowRunAttempts.version} + 1`,
        updatedAt: new Date(),
        ...(params.status === 'running'
          ? {startedAt: sql`coalesce(${workflowRunAttempts.startedAt}, now())`}
          : {}),
        ...(isWorkflowRunTerminal(params.status) ? {finishedAt: sql`now()`} : {}),
      })
      .where(
        and(
          eq(workflowRunAttempts.id, target.attempt.id),
          eq(workflowRunAttempts.version, params.expectedVersion),
          notInArray(workflowRunAttempts.status, TERMINAL_WORKFLOW_RUN_STATUSES),
        ),
      )
      .returning();

    const attemptRow = rows[0];
    if (!attemptRow) {
      const existing = await tx
        .select()
        .from(workflowRunAttempts)
        .where(eq(workflowRunAttempts.id, target.attempt.id))
        .limit(1);
      const existingRow = existing[0];
      if (
        existingRow &&
        (existingRow.status === params.status || isWorkflowRunTerminal(existingRow.status))
      ) {
        return {
          run: {...toWorkflowRun(target.run), version: existingRow.version},
          changed: false,
        };
      }
      throw new Error(
        `Optimistic lock failure: run attempt ${target.attempt.id} version ${params.expectedVersion}`,
      );
    }

    const shouldMirror = target.run.currentAttempt === attemptRow.attempt;
    const [runRow] = shouldMirror
      ? await tx
          .update(workflowRuns)
          .set({
            status: params.status,
            version: sql`${workflowRuns.version} + 1`,
            updatedAt: new Date(),
            ...(params.status === 'running'
              ? {startedAt: sql`coalesce(${workflowRuns.startedAt}, now())`}
              : {}),
            ...(isWorkflowRunTerminal(params.status) ? {finishedAt: sql`now()`} : {}),
          })
          .where(eq(workflowRuns.id, target.run.id))
          .returning()
      : [target.run];

    const run = {...toWorkflowRun(runRow ?? target.run), version: attemptRow.version};

    if (shouldMirror && isWorkflowRunTerminal(run.status)) {
      await writeWorkflowsOutboxEvent(tx, {
        type: WORKFLOWS_WORKFLOW_RUN_TERMINATED,
        payload: {
          workflowRunId: run.id,
          workflowRunAttemptId: attemptRow.id,
          projectId: run.projectId,
          status: run.status,
        },
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
}

export interface UpdateJobExecutionStatusAtVersionParams {
  jobExecutionId: string;
  status: JobExecutionStatus;
  expectedVersion: number;
  statusReason?: JobStatusReason | null | undefined;
  markTimedOut?: boolean;
}

async function resolveJobExecutionOutputs(
  tx: Tx,
  params: {
    jobExecutionId: string;
    status: JobExecutionStatus;
    statusReason: JobStatusReason | null;
  },
): Promise<Record<string, unknown> | null> {
  const [target] = await tx
    .select({execution: jobExecutions, job: jobs, attempt: workflowRunAttempts, run: workflowRuns})
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(jobExecutions.id, params.jobExecutionId))
    .limit(1);
  if (!target) throw new JobNotFoundError(params.jobExecutionId);
  const model = target.attempt.model;
  if (!model) return null;
  const modelJob = model.jobs.find((job) => job.key === target.job.key);
  if (!modelJob || modelJob.outputs === undefined) return null;

  const executionRows = await tx
    .select()
    .from(jobExecutions)
    .where(eq(jobExecutions.jobId, target.job.id))
    .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));
  const executions = executionRows.map((row) =>
    row.id === target.execution.id
      ? toJobExecution({...row, status: params.status, statusReason: params.statusReason})
      : toJobExecution(row),
  );
  const jobExecution = executions.find((execution) => execution.id === target.execution.id);
  if (!jobExecution) throw new JobNotFoundError(params.jobExecutionId);

  const stepRows = await tx
    .select()
    .from(steps)
    .where(eq(steps.jobExecutionId, params.jobExecutionId))
    .orderBy(asc(steps.position), asc(steps.id));
  const attemptRows = await tx
    .select()
    .from(stepAttempts)
    .where(eq(stepAttempts.jobExecutionId, params.jobExecutionId))
    .orderBy(asc(stepAttempts.executionOrder), asc(stepAttempts.id));
  const dependencyJobs = await getDirectDependencyJobContexts(target.job.id, tx);

  const context = assembleExecutionResolutionContext({
    run: toWorkflowRun(target.run),
    triggerPayload: target.run.triggerPayload,
    inputs: target.run.inputs,
    vars: await loadReferencedVariables({
      model,
      jobs: [modelJob],
      workspaceId: target.run.workspaceId,
      projectId: target.run.projectId,
      definitionId: target.run.definitionId,
    }),
    job: toJob(target.job),
    jobExecution,
    executions,
    steps: stepRows.map(toStep),
    attempts: attemptRows.map(toStepAttempt),
    jobs: dependencyJobs,
  });

  return materializeJobOutputs({
    job: modelJob,
    context,
    definitionId: target.run.definitionId,
  });
}

async function updateJobExecutionStatusAtVersion(
  tx: Tx,
  params: UpdateJobExecutionStatusAtVersionParams,
): Promise<{execution: JobExecution; changed: boolean} | null> {
  let status = params.status;
  let statusReason = params.statusReason ?? null;
  let outputs: Record<string, unknown> | null | undefined;
  if (TERMINAL_EXECUTION_STATUSES.includes(status)) {
    outputs = null;
  }
  if (status === 'succeeded') {
    try {
      outputs = await resolveJobExecutionOutputs(tx, {
        jobExecutionId: params.jobExecutionId,
        status,
        statusReason,
      });
    } catch (error) {
      if (!(error instanceof InterpolationUnresolvableError)) throw error;
      status = 'failed';
      statusReason = 'unknown';
      outputs = null;
    }
  }

  const rows = await tx
    .update(jobExecutions)
    .set({
      status,
      statusReason,
      ...(outputs === undefined ? {} : {outputs}),
      version: sql`${jobExecutions.version} + 1`,
      updatedAt: new Date(),
      ...(params.markTimedOut ? {timedOutAt: new Date()} : {}),
      ...(TERMINAL_EXECUTION_STATUSES.includes(status) ? {finishedAt: sql`now()`} : {}),
    })
    .where(
      and(
        eq(jobExecutions.id, params.jobExecutionId),
        eq(jobExecutions.version, params.expectedVersion),
        notInArray(jobExecutions.status, TERMINAL_EXECUTION_STATUSES),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) return null;
  return {execution: toJobExecution(row), changed: true};
}

export interface UpdateJobExecutionStatusParams {
  jobExecutionId: string;
  status: JobExecutionStatus;
  expectedVersion: number;
  statusReason?: JobStatusReason | null | undefined;
}

export async function updateJobExecutionStatus(
  params: UpdateJobExecutionStatusParams,
): Promise<JobExecution> {
  const statusReason = params.statusReason ?? null;
  const result = await db().transaction(async (tx) => {
    const updated = await updateJobExecutionStatusAtVersion(tx, {
      jobExecutionId: params.jobExecutionId,
      status: params.status,
      expectedVersion: params.expectedVersion,
      statusReason,
    });
    if (updated) return updated;

    const existing = await tx
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.id, params.jobExecutionId))
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
      `Optimistic lock failure: job execution ${params.jobExecutionId} version ${params.expectedVersion}`,
    );
  });

  if (result.changed) recordWorkflowJobExecutionStatusChanged(result.execution.status);

  return result.execution;
}

// Returns null on version mismatch so callers can choose throw vs treat-as-success.
export async function updateJobStatusAtVersion(
  tx: Tx,
  params: UpdateJobStatusAtVersionParams,
): Promise<{job: Job; changed: boolean} | null> {
  const outputs = isJobTerminal(params.status)
    ? await reduceJobOutputs(tx, {jobId: params.jobId, status: params.status})
    : undefined;
  const rows = await tx
    .update(jobs)
    .set({
      status: params.status,
      statusReason: params.statusReason ?? null,
      ...(outputs === undefined ? {} : {outputs}),
      version: sql`${jobs.version} + 1`,
      updatedAt: new Date(),
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
    const [identity] = await tx
      .select({
        workflowRunId: workflowRuns.id,
        workflowRunAttemptId: workflowRunAttempts.id,
      })
      .from(jobs)
      .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
      .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
      .where(eq(jobs.id, job.id))
      .limit(1);
    if (!identity) {
      throw new Error(`Cannot enqueue job-terminal event: job ${job.id} not found`);
    }
    await writeWorkflowsOutboxEvent(tx, {
      type: WORKFLOWS_JOB_TERMINATED,
      payload: {
        jobId: job.id,
        workflowRunId: identity.workflowRunId,
        workflowRunAttemptId: identity.workflowRunAttemptId,
        status: job.status,
        statusReason: job.statusReason,
      },
    });
  }

  return {job, changed: true};
}

async function reduceJobOutputs(
  tx: Tx,
  params: {jobId: string; status: JobStatus},
): Promise<Record<string, unknown> | null> {
  if (params.status !== 'succeeded') return null;

  const [row] = await tx
    .select({outputs: jobExecutions.outputs})
    .from(jobExecutions)
    .where(and(eq(jobExecutions.jobId, params.jobId), eq(jobExecutions.status, 'succeeded')))
    .orderBy(desc(jobExecutions.sequence), desc(jobExecutions.id))
    .limit(1);

  return row?.outputs ? {...row.outputs} : null;
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

export async function recordJobExecutionQueuedAt(params: {
  jobExecutionId: string;
  queuedAt: Date;
}): Promise<void> {
  const updated = await db()
    .update(jobExecutions)
    .set({queuedAt: params.queuedAt})
    .where(and(eq(jobExecutions.id, params.jobExecutionId), isNull(jobExecutions.queuedAt)))
    .returning({id: jobExecutions.id});

  if (updated.length > 0) recordWorkflowJobExecutionQueued();
}

export async function recordJobExecutionStartedAt(params: {
  jobExecutionId: string;
  startedAt: Date;
}): Promise<void> {
  const updated = await db()
    .update(jobExecutions)
    .set({startedAt: params.startedAt})
    .where(and(eq(jobExecutions.id, params.jobExecutionId), isNull(jobExecutions.startedAt)))
    .returning({id: jobExecutions.id});

  if (updated.length > 0) recordWorkflowJobExecutionStarted();
}

export async function failJobExecutionAsTimedOut(params: {
  jobExecutionId: string;
  workflowRunAttemptId: string;
  expectedVersion: number;
}): Promise<JobExecution> {
  const result = await db().transaction(async (tx) => {
    const updated = await updateJobExecutionStatusAtVersion(tx, {
      jobExecutionId: params.jobExecutionId,
      status: 'failed',
      expectedVersion: params.expectedVersion,
      statusReason: 'timed_out',
      markTimedOut: true,
    });

    if (!updated) {
      const existing = await tx
        .select()
        .from(jobExecutions)
        .where(eq(jobExecutions.id, params.jobExecutionId))
        .limit(1);
      const row = existing[0];
      if (row && row.timedOutAt !== null) {
        return {execution: toJobExecution(row), changed: false};
      }
      throw new Error(
        `Optimistic lock failure: job execution ${params.jobExecutionId} version ${params.expectedVersion}`,
      );
    }

    await writeWorkflowsOutboxEvent(tx, {
      type: WORKFLOWS_JOB_EXECUTION_TIMED_OUT,
      payload: {
        jobId: updated.execution.jobId,
        jobExecutionId: params.jobExecutionId,
        workflowRunAttemptId: params.workflowRunAttemptId,
      },
    });

    return updated;
  });

  if (result.changed) {
    recordWorkflowJobExecutionStatusChanged(result.execution.status);
    recordWorkflowJobExecutionTimedOut();
  }

  return result.execution;
}

export async function resolveJobExecutionAfterLeaseExpiry(params: {
  jobExecutionId: string;
  expectedVersion: number;
}): Promise<{status: RuntimeCompletionStatus; executionVersion: number}> {
  const result = await db().transaction(async (tx) => {
    const jobExecutionSteps = await getStepsByJobExecutionIdForUpdate(params.jobExecutionId, tx);
    let changedJobExecution: JobExecution | null = null;

    if (jobExecutionSteps.length === 0) {
      throw new JobNotFoundError(params.jobExecutionId);
    }

    if (jobExecutionSteps.every((step) => isTerminal(step.status))) {
      const status = deriveCompletion(jobExecutionSteps);
      const updated = await updateJobExecutionStatusAtVersion(tx, {
        jobExecutionId: params.jobExecutionId,
        status,
        expectedVersion: params.expectedVersion,
        statusReason: statusReasonForStepCompletion(status),
      });
      changedJobExecution = updated?.changed ? updated.execution : null;
    } else {
      const updated = await updateJobExecutionStatusAtVersion(tx, {
        jobExecutionId: params.jobExecutionId,
        status: 'failed',
        expectedVersion: params.expectedVersion,
        statusReason: 'runner_lost',
      });
      changedJobExecution = updated?.changed ? updated.execution : null;
      await bulkUpdateStepStatuses(
        {jobExecutionId: params.jobExecutionId, status: 'cancelled'},
        tx,
      );
    }

    const jobExecutionRow = (
      await tx
        .select()
        .from(jobExecutions)
        .where(eq(jobExecutions.id, params.jobExecutionId))
        .limit(1)
    )[0];
    if (!jobExecutionRow) {
      throw new Error(`Job execution not found resolving lease expiry: ${params.jobExecutionId}`);
    }
    const status: RuntimeCompletionStatus =
      jobExecutionRow.status === 'succeeded' ? 'succeeded' : 'failed';
    return {status, executionVersion: jobExecutionRow.version, changedJobExecution};
  });

  recordWorkflowJobExecutionLeaseExpiryResolved(result.status);
  if (result.changedJobExecution) {
    recordWorkflowJobExecutionStatusChanged(result.changedJobExecution.status);
  }

  return {status: result.status, executionVersion: result.executionVersion};
}

function statusReasonForStepCompletion(status: RuntimeCompletionStatus): JobStatusReason | null {
  return status === 'failed' ? 'step_failed' : null;
}

export interface EvaluateJobSuccessResult {
  status: RuntimeCompletionStatus;
  statusReason: JobStatusReason | null;
}

export function evaluateJobSuccess(params: {
  success: string | null;
  executions: readonly JobExecution[];
  jobs?: readonly JobContextInput[];
}): EvaluateJobSuccessResult {
  const expression = createWorkflowExpression({
    source: params.success ?? DEFAULT_JOB_SUCCESS,
    check: {mode: 'syntax'},
  });
  const context = {
    ...assembleExecutionsContext(params.executions),
    ...(params.jobs === undefined ? {} : assembleJobsContext(params.jobs)),
  };
  // Fail closed so a runtime-only predicate error cannot abort job resolution.
  let passed: boolean;
  let predicateEvaluationFailed = false;
  try {
    passed = evaluateWorkflowPredicate(expression, context);
  } catch (error) {
    if (!(error instanceof WorkflowExpressionEvaluationError)) throw error;
    passed = false;
    predicateEvaluationFailed = true;
  }
  const status: RuntimeCompletionStatus = passed ? 'succeeded' : 'failed';
  if (status === 'succeeded') return {status, statusReason: null};

  // A thrown predicate is a job-level failure, not evidence that any execution failed.
  return {
    status,
    statusReason: predicateEvaluationFailed
      ? 'unknown'
      : (params.executions.find((execution) => execution.statusReason)?.statusReason ??
        'step_failed'),
  };
}

export async function resolveJobStatusFromJobExecutions(params: {
  jobId: string;
}): Promise<{status: RuntimeCompletionStatus; jobVersion: number}> {
  const result = await db().transaction(async (tx) => {
    const jobRow = (await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1))[0];
    if (!jobRow) throw new JobNotFoundError(params.jobId);

    const jobExecutionRows = await tx
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.jobId, params.jobId))
      .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));

    if (jobExecutionRows.length === 0) {
      throw new Error(`Cannot resolve job ${params.jobId}: no job executions found`);
    }

    const {status, statusReason} = evaluateJobSuccess({
      success: jobRow.success,
      executions: jobExecutionRows.map(toJobExecution),
      jobs: await getDirectDependencyJobContexts(params.jobId, tx),
    });

    const updated = await updateJobStatusAtVersion(tx, {
      jobId: params.jobId,
      status,
      expectedVersion: jobRow.version,
      statusReason,
    });
    if (updated) return {job: updated.job, changed: updated.changed};

    const existing = (await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1))[0];
    if (!existing) throw new JobNotFoundError(params.jobId);
    return {job: toJob(existing), changed: false};
  });

  if (result.changed) recordWorkflowJobStatusChanged(result.job.status);
  return {
    status: result.job.status === 'succeeded' ? 'succeeded' : 'failed',
    jobVersion: result.job.version,
  };
}

// Enqueue the steps-settled signal in the same transaction as the final per-step
// result, so per-step execution observes it exactly once (the outbox is at-least-once;
// the job workflow dedupes the signal). Drives the Temporal JOB_FINISHED_SIGNAL; the
// job's terminal fact is emitted separately by updateJobStatusAtVersion.
export async function writeJobStepsSettledOutbox(
  tx: Tx,
  params: {jobId: string; jobExecutionId: string; status: 'succeeded' | 'failed'},
): Promise<void> {
  const rows = await tx
    .select({
      workflowRunId: workflowRuns.id,
      workflowRunAttemptId: workflowRunAttempts.id,
    })
    .from(jobs)
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(jobs.id, params.jobId))
    .limit(1);
  const identity = rows[0];
  if (!identity) {
    throw new Error(`Cannot enqueue job-steps-settled event: job ${params.jobId} not found`);
  }

  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_JOB_STEPS_SETTLED,
    payload: {
      jobId: params.jobId,
      jobExecutionId: params.jobExecutionId,
      workflowRunId: identity.workflowRunId,
      workflowRunAttemptId: identity.workflowRunAttemptId,
      status: params.status,
    },
  });
}

export interface BulkUpdateStepStatusesParams {
  jobExecutionId: string;
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

  await tx
    .update(steps)
    .set({
      status: params.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(steps.jobExecutionId, params.jobExecutionId),
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
    const finalizedAttempts = await tx
      .update(stepAttempts)
      .set({status: params.status, logOutcome: 'abandoned', finishedAt: new Date()})
      .from(steps)
      .where(
        and(
          eq(stepAttempts.stepId, steps.id),
          eq(steps.jobExecutionId, params.jobExecutionId),
          eq(stepAttempts.status, 'running'),
        ),
      )
      .returning({
        stepId: stepAttempts.stepId,
        attempt: stepAttempts.attempt,
        logOutcome: stepAttempts.logOutcome,
      });

    if (finalizedAttempts.length > 0) {
      const firstAttempt = finalizedAttempts[0];
      if (!firstAttempt) return;
      const identity = await getStepAttemptTerminatedOutboxIdentity(tx, firstAttempt.stepId);
      await writeWorkflowsOutboxEvents(
        tx,
        finalizedAttempts.map((attempt) => ({
          type: WORKFLOWS_STEP_ATTEMPT_TERMINATED,
          payload: {
            jobId: identity.jobId,
            workflowRunId: identity.workflowRunId,
            workflowRunAttemptId: identity.workflowRunAttemptId,
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

export async function getStepsByJobExecutionIdForUpdate(
  jobExecutionId: string,
  tx: Tx,
): Promise<Step[]> {
  const rows = await tx
    .select()
    .from(steps)
    .where(eq(steps.jobExecutionId, jobExecutionId))
    .orderBy(asc(steps.position))
    .for('update');
  return rows.map(toStep);
}

export async function getStepAttemptsByJobExecutionId(
  jobExecutionId: string,
  tx: Tx,
): Promise<StepAttempt[]> {
  const rows = await tx
    .select()
    .from(stepAttempts)
    .where(eq(stepAttempts.jobExecutionId, jobExecutionId))
    .orderBy(asc(stepAttempts.executionOrder), asc(stepAttempts.id));
  return rows.map(toStepAttempt);
}

export interface MarkStepRunningParams {
  jobExecutionId: string;
  stepId: string;
}

export async function markStepRunning(params: MarkStepRunningParams, tx: Tx): Promise<Step | null> {
  const rows = await tx
    .update(steps)
    .set({status: 'running', updatedAt: new Date()})
    .where(
      and(
        eq(steps.id, params.stepId),
        eq(steps.jobExecutionId, params.jobExecutionId),
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
      jobExecutionId: step.jobExecutionId,
      stepId: step.id,
      attempt: step.currentAttempt,
      config: step.config,
    },
    tx,
  );
  return step;
}

export interface DispatchStepWithCompletedConfigParams {
  jobExecutionId: string;
  stepId: string;
  config: Record<string, unknown>;
}

export async function dispatchStepWithCompletedConfig(
  params: DispatchStepWithCompletedConfigParams,
  tx: Tx,
): Promise<Step | null> {
  const rows = await tx
    .update(steps)
    .set({
      status: 'running',
      config: params.config,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(steps.id, params.stepId),
        eq(steps.jobExecutionId, params.jobExecutionId),
        sql`${steps.status} NOT IN ('succeeded','failed','cancelled')`,
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) return null;
  const step = toStep(row);
  await insertRunningStepAttempt(
    {
      jobExecutionId: step.jobExecutionId,
      stepId: step.id,
      attempt: step.currentAttempt,
      config: params.config,
    },
    tx,
  );
  return step;
}

export async function settleJobFailed(
  tx: Tx,
  params: {
    jobId: string;
    jobExecutionId: string;
    failedStepId: string;
    error: Record<string, unknown>;
  },
): Promise<'succeeded' | 'failed' | null> {
  await applyStepResult(
    {
      jobExecutionId: params.jobExecutionId,
      stepId: params.failedStepId,
      status: 'failed',
      error: params.error,
    },
    tx,
  );
  await cancelRemainingSteps({jobExecutionId: params.jobExecutionId}, tx);

  const after = await getStepsByJobExecutionIdForUpdate(params.jobExecutionId, tx);
  if (!after.every((step) => isTerminal(step.status))) return null;

  const status = deriveCompletion(after);
  await writeJobStepsSettledOutbox(tx, {
    jobId: params.jobId,
    jobExecutionId: params.jobExecutionId,
    status,
  });
  return status;
}

export interface InsertRunningStepAttemptParams {
  jobExecutionId: string;
  stepId: string;
  attempt: number;
  config?: Record<string, unknown> | null;
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
    .where(eq(stepAttempts.jobExecutionId, params.jobExecutionId));

  await tx
    .insert(stepAttempts)
    .values({
      jobExecutionId: params.jobExecutionId,
      stepId: params.stepId,
      attempt: params.attempt,
      executionOrder: nextExecutionOrder,
      status: 'running',
      config: params.config ?? null,
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
  restartFeedback?: string | null;
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
      restartFeedback: params.restartFeedback ?? null,
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
      stepId: stepAttempts.stepId,
      attempt: stepAttempts.attempt,
      logOutcome: stepAttempts.logOutcome,
    });

  const row = rows[0];
  if (!row) return;

  await writeStepAttemptTerminatedOutbox(tx, {
    stepId: row.stepId,
    attempt: row.attempt,
    logOutcome: row.logOutcome ?? params.logOutcome,
  });
}

export async function writeStepAttemptTerminatedOutbox(
  tx: Tx,
  params: {stepId: string; attempt: number; logOutcome: LogOutcomeDto},
): Promise<void> {
  const identity = await getStepAttemptTerminatedOutboxIdentity(tx, params.stepId);

  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_STEP_ATTEMPT_TERMINATED,
    payload: {
      jobId: identity.jobId,
      workflowRunId: identity.workflowRunId,
      workflowRunAttemptId: identity.workflowRunAttemptId,
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
  stepId: string,
): Promise<{
  jobId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  workspaceId: string;
  projectId: string;
}> {
  const rows = await tx
    .select({
      jobId: jobExecutions.jobId,
      workflowRunId: workflowRuns.id,
      workflowRunAttemptId: workflowRunAttempts.id,
      workspaceId: workflowRuns.workspaceId,
      projectId: workflowRuns.projectId,
    })
    .from(steps)
    .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(steps.id, stepId))
    .limit(1);
  const identity = rows[0];
  if (!identity) {
    throw new Error(`Cannot enqueue step-attempt-terminated event: step ${stepId} not found`);
  }

  return identity;
}

export interface RewindStepsToPendingParams {
  jobExecutionId: string;
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
      error: null,
      version: sql`${steps.version} + 1`,
      currentAttempt: sql`${steps.currentAttempt} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(steps.jobExecutionId, params.jobExecutionId),
        gte(steps.position, params.fromPosition),
      ),
    );
}

// Enqueue the durable audit record of a restart, in the same transaction as the
// rewind. Looks up the workflow run id like writeJobStepsSettledOutbox.
export async function writeStepRestartEnqueuedOutbox(
  tx: Tx,
  params: {
    jobId: string;
    failedStepId: string;
    failedStepAttempt: number;
    restartFromStepId: string;
    feedback: string;
  },
): Promise<void> {
  const rows = await tx
    .select({
      workflowRunId: workflowRuns.id,
      workflowRunAttemptId: workflowRunAttempts.id,
    })
    .from(jobs)
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(jobs.id, params.jobId))
    .limit(1);
  const identity = rows[0];
  if (!identity) {
    throw new Error(`Cannot enqueue step-restart event: job ${params.jobId} not found`);
  }

  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_STEP_RESTART_ENQUEUED,
    payload: {
      jobId: params.jobId,
      workflowRunId: identity.workflowRunId,
      workflowRunAttemptId: identity.workflowRunAttemptId,
      failedStepId: params.failedStepId,
      failedStepAttempt: params.failedStepAttempt,
      restartFromStepId: params.restartFromStepId,
      feedback: params.feedback,
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
    .select({stepAttempt: stepAttempts})
    .from(stepAttempts)
    .innerJoin(steps, eq(stepAttempts.stepId, steps.id))
    .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(asc(stepAttempts.executionOrder));
  return rows.map((row) => toStepAttempt(row.stepAttempt));
}

export async function getStepAttemptsByJobIds(jobIds: string[]): Promise<StepAttempt[]> {
  if (jobIds.length === 0) return [];
  const rows = await db()
    .select({stepAttempt: stepAttempts, jobId: jobExecutions.jobId})
    .from(stepAttempts)
    .innerJoin(steps, eq(stepAttempts.stepId, steps.id))
    .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
    .where(inArray(jobExecutions.jobId, jobIds))
    .orderBy(asc(jobExecutions.jobId), asc(stepAttempts.executionOrder));
  return rows.map((row) => toStepAttempt(row.stepAttempt));
}

export interface ApplyStepResultParams {
  jobExecutionId: string;
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
        eq(steps.jobExecutionId, params.jobExecutionId),
        sql`${steps.status} NOT IN ('succeeded','failed','cancelled')`,
      ),
    );
}

export interface CancelRemainingStepsParams {
  jobExecutionId: string;
}

// The just-failed step is already terminal, so the shared guarded sweep leaves
// it alone and only the still-pending siblings are cancelled.
export async function cancelRemainingSteps(
  params: CancelRemainingStepsParams,
  tx: Tx,
): Promise<void> {
  await bulkUpdateStepStatuses({jobExecutionId: params.jobExecutionId, status: 'cancelled'}, tx);
}
