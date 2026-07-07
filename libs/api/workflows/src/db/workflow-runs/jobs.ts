import {DEFAULT_JOB_SUCCESS} from '@shipfox/api-definitions';
import {WORKFLOWS_JOB_TERMINATED} from '@shipfox/api-workflows-dto';
import {
  capTraceEntries,
  createWorkflowExpression,
  evaluatePlannedPredicateAtSite,
  predicateTraceEntry,
} from '@shipfox/expression';
import {and, asc, desc, eq, inArray, notInArray, sql} from 'drizzle-orm';
import {explicitConditionTrace} from '#core/condition-trace.js';
import {isJobTerminal, type Job, type JobStatus, type JobStatusReason} from '#core/entities/job.js';
import type {JobExecution} from '#core/entities/job-execution.js';
import type {PersistedEvaluationTraceEntry} from '#core/entities/step.js';
import {JobNotFoundError} from '#core/errors.js';
import {
  assembleExecutionsContext,
  assembleJobActivationContext,
  assembleJobsContext,
  type JobContextInput,
} from '#core/step-config/assemble-run-context.js';
import type {RuntimeCompletionStatus} from '#core/workflow-scheduling/runtime-dag.js';
import {recordWorkflowJobStatusChanged} from '#metrics/instance.js';
import {db, type Tx} from '../db.js';
import {writeWorkflowsOutboxEvent} from '../outbox-writes.js';
import {jobExecutions, toJobExecution} from '../schema/job-executions.js';
import {jobs, toJob} from '../schema/jobs.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {toWorkflowRun, workflowRuns} from '../schema/workflow-runs.js';
import {getWorkflowRunById} from './queries.js';
import {getWorkflowContextForJob, optimisticLockRetry, TERMINAL_JOB_STATUSES} from './shared.js';

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

export interface EvaluateJobActivationsParams {
  runAttemptId: string;
  jobs: readonly {
    jobId: string;
    expectedVersion: number;
  }[];
}

export type JobActivationDecision =
  | {
      kind: 'start-job';
      jobId: string;
    }
  | {
      kind: 'terminal-job';
      jobId: string;
      status: RuntimeCompletionStatus;
      jobVersion: number;
    };

type InternalJobActivationDecision = JobActivationDecision & {changed?: boolean};

export async function evaluateJobActivations(
  params: EvaluateJobActivationsParams,
): Promise<JobActivationDecision[]> {
  if (params.jobs.length === 0) return [];

  const result = await db().transaction(async (tx) => {
    const expectedVersions = new Map(
      params.jobs.map((job) => [job.jobId, job.expectedVersion] as const),
    );
    const jobIds = params.jobs.map((job) => job.jobId);
    const targets = await tx
      .select({job: jobs, attempt: workflowRunAttempts, run: workflowRuns})
      .from(jobs)
      .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
      .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
      .where(and(eq(jobs.workflowRunAttemptId, params.runAttemptId), inArray(jobs.id, jobIds)))
      .for('update');

    if (targets.length !== jobIds.length) {
      const found = new Set(targets.map((target) => target.job.id));
      const missing = jobIds.filter((jobId) => !found.has(jobId));
      throw new Error(`Cannot evaluate missing activation jobs: ${missing.join(', ')}`);
    }

    const contextsByJobKey = await directDependencyContextsByJobKey(
      tx,
      params.runAttemptId,
      targets.map((target) => toJob(target.job)),
    );
    const targetsByJobId = new Map(targets.map((target) => [target.job.id, target]));
    const decisions: InternalJobActivationDecision[] = [];

    for (const input of params.jobs) {
      const target = targetsByJobId.get(input.jobId);
      if (!target) throw new Error(`Cannot evaluate missing activation job: ${input.jobId}`);
      const job = toJob(target.job);
      if (isJobTerminal(job.status)) {
        decisions.push({
          kind: 'terminal-job',
          jobId: job.id,
          status: runtimeCompletionStatusForJob(job.status),
          jobVersion: job.version,
        });
        continue;
      }

      const modelJob = target.attempt.model?.jobs.find((item) => item.key === target.job.key);
      if (modelJob?.if === undefined) {
        decisions.push({kind: 'start-job', jobId: job.id});
        continue;
      }

      const context = assembleJobActivationContext({
        run: toWorkflowRun(target.run),
        triggerPayload: target.run.triggerPayload,
        inputs: target.run.inputs,
        jobs: job.dependencies.flatMap((key) => {
          const dependency = contextsByJobKey.get(key);
          return dependency === undefined ? [] : [dependency];
        }),
      });
      const outcome = evaluatePlannedPredicateAtSite({
        expression: modelJob.if,
        field: 'job.if',
        site: context.site,
        context: context.values,
      });
      if (outcome.value) {
        decisions.push({kind: 'start-job', jobId: job.id});
        continue;
      }

      const statusReason = outcome.evaluationFailed ? 'condition_errored' : 'condition_rejected';
      const evaluationTrace = explicitConditionTrace({
        expression: modelJob.if,
        field: 'job.if',
        route: outcome.route,
        site: context.site,
        value: outcome.value,
        degraded: outcome.evaluationFailed,
      });
      const expectedVersion = expectedVersions.get(job.id);
      if (expectedVersion === undefined) {
        throw new Error(`Missing expected version for activation job ${job.id}`);
      }
      const updated = await updateJobStatusAtVersion(tx, {
        jobId: job.id,
        status: 'skipped',
        expectedVersion,
        statusReason,
        evaluationTrace,
      });
      if (updated) {
        decisions.push({
          kind: 'terminal-job',
          jobId: job.id,
          status: 'skipped',
          jobVersion: updated.job.version,
          changed: updated.changed,
        });
        continue;
      }

      const [existing] = await tx.select().from(jobs).where(eq(jobs.id, job.id)).limit(1);
      if (existing && isJobTerminal(existing.status)) {
        decisions.push({
          kind: 'terminal-job',
          jobId: job.id,
          status: runtimeCompletionStatusForJob(existing.status),
          jobVersion: existing.version,
        });
        continue;
      }
      throw new Error(`Optimistic lock failure evaluating activation for job ${job.id}`);
    }

    return decisions;
  });

  for (const decision of result) {
    if (decision.kind === 'terminal-job' && decision.changed) {
      recordWorkflowJobStatusChanged(decision.status);
    }
  }

  return result.map(({changed: _changed, ...decision}) => decision);
}

async function directDependencyContextsByJobKey(
  tx: Tx,
  runAttemptId: string,
  targetJobs: readonly Job[],
): Promise<ReadonlyMap<string, JobContextInput>> {
  const dependencyKeys = new Set(targetJobs.flatMap((job) => job.dependencies));
  if (dependencyKeys.size === 0) return new Map();

  const rows = await tx
    .select({job: jobs, execution: jobExecutions})
    .from(jobs)
    .leftJoin(jobExecutions, eq(jobExecutions.jobId, jobs.id))
    .where(and(eq(jobs.workflowRunAttemptId, runAttemptId), inArray(jobs.key, [...dependencyKeys])))
    .orderBy(asc(jobs.position), asc(jobs.id), asc(jobExecutions.sequence), asc(jobExecutions.id));

  const contextsByJobKey = new Map<string, JobContextInput & {executions: JobExecution[]}>();
  for (const row of rows) {
    let context = contextsByJobKey.get(row.job.key);
    if (!context) {
      context = {job: toJob(row.job), executions: []};
      contextsByJobKey.set(row.job.key, context);
    }
    if (row.execution) context.executions.push(toJobExecution(row.execution));
  }

  return contextsByJobKey;
}

function runtimeCompletionStatusForJob(status: JobStatus): RuntimeCompletionStatus {
  if (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'skipped'
  ) {
    return status;
  }
  throw new Error(`Job status is not terminal: ${status}`);
}

export interface UpdateJobStatusAtVersionParams {
  jobId: string;
  status: JobStatus;
  expectedVersion: number;
  statusReason?: JobStatusReason | null | undefined;
  evaluationTrace?: readonly PersistedEvaluationTraceEntry[] | null | undefined;
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
      ...(params.evaluationTrace === undefined ? {} : {evaluationTrace: params.evaluationTrace}),
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
    const identity = await getWorkflowContextForJob(job.id, tx);
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
  evaluationTrace?: readonly PersistedEvaluationTraceEntry[] | null | undefined;
}

export async function updateJobStatus(params: UpdateJobStatusParams): Promise<Job> {
  const statusReason = params.statusReason ?? null;
  const result = await db().transaction(async (tx) => {
    return await optimisticLockRetry({
      updateFn: () =>
        updateJobStatusAtVersion(tx, {
          jobId: params.jobId,
          status: params.status,
          expectedVersion: params.expectedVersion,
          statusReason,
          evaluationTrace: params.evaluationTrace,
        }),
      fetchFn: async () => {
        const row = (await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1))[0];
        return row ? toJob(row) : undefined;
      },
      matchFn: (job) =>
        (job.status === params.status && job.statusReason === statusReason) ||
        isJobTerminal(job.status)
          ? {job, changed: false}
          : null,
      failureMessage: `Optimistic lock failure: job ${params.jobId} version ${params.expectedVersion}`,
    });
  });

  if (result.changed) recordWorkflowJobStatusChanged(result.job.status);

  return result.job;
}

export interface EvaluateJobSuccessResult {
  status: RuntimeCompletionStatus;
  statusReason: JobStatusReason | null;
  trace: readonly PersistedEvaluationTraceEntry[];
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
  const outcome = evaluatePlannedPredicateAtSite({
    expression,
    field: 'job.success',
    site: 'job-resolution',
    context,
  });
  const trace = capTraceEntries([
    {
      ...predicateTraceEntry({
        expression: expression.source,
        route: outcome.route,
        site: 'job-resolution',
        value: outcome.value,
        degraded: outcome.evaluationFailed,
      }),
      field: 'job.success',
    },
  ]);
  const passed = outcome.value;
  const status: RuntimeCompletionStatus = passed ? 'succeeded' : 'failed';
  if (status === 'succeeded') return {status, statusReason: null, trace};

  // A thrown predicate is a job-level failure, not evidence that any execution failed.
  return {
    status,
    statusReason: outcome.evaluationFailed
      ? 'unknown'
      : (params.executions.find((execution) => execution.statusReason)?.statusReason ??
        'step_failed'),
    trace,
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

    const {status, statusReason, trace} = evaluateJobSuccess({
      success: jobRow.success,
      executions: jobExecutionRows.map(toJobExecution),
      jobs: await getDirectDependencyJobContexts(params.jobId, tx),
    });

    return optimisticLockRetry({
      updateFn: () =>
        updateJobStatusAtVersion(tx, {
          jobId: params.jobId,
          status,
          expectedVersion: jobRow.version,
          statusReason,
          evaluationTrace: trace,
        }),
      fetchFn: async () => {
        const row = (await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1))[0];
        if (!row) throw new JobNotFoundError(params.jobId);
        return toJob(row);
      },
      matchFn: (job) => ({job, changed: false}),
      failureMessage: `Optimistic lock failure: job ${params.jobId} version ${jobRow.version}`,
    });
  });

  if (result.changed) recordWorkflowJobStatusChanged(result.job.status);
  return {
    status: result.job.status === 'succeeded' ? 'succeeded' : 'failed',
    jobVersion: result.job.version,
  };
}
