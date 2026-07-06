import {
  type AgentDefaultsResolver,
  catalogDefaultAgentResolver,
} from '@shipfox/api-agent/core/resolve-agent-config';
import {
  WORKFLOWS_JOB_ACTIVATED,
  type WorkflowsJobActivatedEventDto,
} from '@shipfox/api-workflows-dto';
import {
  analyzeContextRootKeyAccess,
  extractExactContextRoots,
  type WorkflowExpressionEvaluationContext,
} from '@shipfox/expression';
import {and, asc, count, eq, inArray, isNull, notInArray, sql} from 'drizzle-orm';
import type {JobListeningTrigger, JobStatus, ResolutionReason} from '#core/entities/job.js';
import type {JobExecutionStatus, WorkflowExecutionEvent} from '#core/entities/job-execution.js';
import {
  AgentConfigUnresolvableError,
  InterpolationUnresolvableError,
  InvalidJobRunnerLabelsError,
} from '#core/errors.js';
import {
  assembleJobsContext,
  assembleWorkflowRunContext,
  type JobContextInput,
} from '#core/step-config/assemble-run-context.js';
import {
  assembleExecutionCreationContext,
  materializeJobExecutionSteps,
  materializeJobRunner,
  resolveJobExecutionName,
} from '#core/step-config/index.js';
import {
  recordListenerEventsCoalesced,
  recordWorkflowJobExecutionStatusChanged,
  recordWorkflowListenerResolved,
} from '#metrics/instance.js';
import {db, type Tx} from './db.js';
import {writeWorkflowsOutboxEvent} from './outbox-writes.js';
import {jobExecutions, toJobExecution} from './schema/job-executions.js';
import {jobListenerEvents} from './schema/job-listener-events.js';
import {jobs, toJob} from './schema/jobs.js';
import {steps} from './schema/steps.js';
import {workflowRunAttempts} from './schema/workflow-run-attempts.js';
import {toWorkflowRun, workflowRuns} from './schema/workflow-runs.js';
import {
  bulkUpdateStepStatuses,
  evaluateJobSuccess,
  getDirectDependencyJobContexts,
  updateJobStatusAtVersion,
} from './workflow-runs.js';

const TERMINAL_EXECUTION_STATUSES: JobExecutionStatus[] = ['succeeded', 'failed', 'cancelled'];

export interface ActivateJobListenerParams {
  jobId: string;
  expectedVersion: number;
}

export interface ActivateJobListenerResult {
  status: 'running' | 'terminal';
  jobStatus: JobStatus;
  jobVersion: number;
  executionCount: number;
}

type JobActivatedListenerMatcher = Extract<
  WorkflowsJobActivatedEventDto,
  {mode: 'listening'}
>['on'][number];

type SnapshotRoot = 'run' | 'trigger' | 'inputs' | 'job' | 'jobs';

interface MatcherSnapshotPlan {
  readonly matcher: JobListeningTrigger;
  readonly roots: ReadonlySet<SnapshotRoot>;
  readonly jobKeys: ReadonlySet<string>;
}

interface ListenerSnapshotPlan {
  readonly on: readonly MatcherSnapshotPlan[];
  readonly until: readonly MatcherSnapshotPlan[];
  readonly roots: ReadonlySet<SnapshotRoot>;
  readonly jobKeys: ReadonlySet<string>;
}

export async function activateJobListener(
  params: ActivateJobListenerParams,
): Promise<ActivateJobListenerResult> {
  return await db().transaction(async (tx) => {
    const [target] = await tx
      .select({job: jobs, run: workflowRuns})
      .from(jobs)
      .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
      .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
      .where(eq(jobs.id, params.jobId))
      .limit(1)
      .for('update');
    if (!target) throw new Error(`Job not found: ${params.jobId}`);

    const [{value: executionCount} = {value: 0}] = await tx
      .select({value: count()})
      .from(jobExecutions)
      .where(eq(jobExecutions.jobId, params.jobId));

    if (['succeeded', 'failed', 'cancelled', 'skipped'].includes(target.job.status)) {
      return {
        status: 'terminal',
        jobStatus: target.job.status,
        jobVersion: target.job.version,
        executionCount,
      };
    }

    let job = toJob(target.job);
    if (target.job.status === 'pending') {
      const updated = await updateJobStatusAtVersion(tx, {
        jobId: params.jobId,
        status: 'running',
        expectedVersion: params.expectedVersion,
      });
      if (!updated) {
        const [existing] = await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1);
        if (existing?.status !== 'running') {
          throw new Error(
            `Optimistic lock failure activating listener job ${params.jobId} version ${params.expectedVersion}`,
          );
        }
        job = toJob(existing);
      } else {
        job = updated.job;
      }
    }

    const listenerRows = await tx
      .update(jobs)
      .set({listenerStatus: 'listening', updatedAt: new Date()})
      .where(and(eq(jobs.id, params.jobId), eq(jobs.listenerStatus, 'inactive')))
      .returning();

    if (listenerRows[0]) {
      const matchers = {
        on: target.job.listeningOn ?? [],
        until: target.job.listeningUntil ?? null,
      };
      const snapshotPlan = planListenerFilterSnapshots(matchers);
      const snapshotContext = await assembleListenerSnapshotContext(tx, {
        job: toJob(target.job),
        run: toWorkflowRun(target.run),
        plan: snapshotPlan,
      });

      await writeWorkflowsOutboxEvent(tx, {
        type: WORKFLOWS_JOB_ACTIVATED,
        payload: {
          jobId: params.jobId,
          workflowRunId: target.run.id,
          workspaceId: target.run.workspaceId,
          mode: 'listening',
          on: applyFilterSnapshots(snapshotPlan.on, snapshotContext),
          until:
            matchers.until === null
              ? null
              : applyFilterSnapshots(snapshotPlan.until, snapshotContext),
        },
      });
    }

    return {status: 'running', jobStatus: job.status, jobVersion: job.version, executionCount};
  });
}

function planListenerFilterSnapshots(params: {
  readonly on: readonly JobListeningTrigger[];
  readonly until: readonly JobListeningTrigger[] | null;
}): ListenerSnapshotPlan {
  const roots = new Set<SnapshotRoot>();
  const jobKeys = new Set<string>();
  const on = params.on.map((matcher) => planMatcherFilterSnapshot(matcher, roots, jobKeys));
  const until = (params.until ?? []).map((matcher) =>
    planMatcherFilterSnapshot(matcher, roots, jobKeys),
  );
  return {on, until, roots, jobKeys};
}

function planMatcherFilterSnapshot(
  matcher: JobListeningTrigger,
  allRoots: Set<SnapshotRoot>,
  allJobKeys: Set<string>,
): MatcherSnapshotPlan {
  if (matcher.filter === undefined) return {matcher, roots: new Set(), jobKeys: new Set()};

  let roots: SnapshotRoot[];
  try {
    roots = extractExactContextRoots(matcher.filter)
      .filter((root) => root !== 'event')
      .filter(isSnapshotRoot);
  } catch {
    return {matcher, roots: new Set(), jobKeys: new Set()};
  }

  if (roots.length === 0) return {matcher, roots: new Set(), jobKeys: new Set()};

  const jobKeys =
    roots.includes('jobs') && matcher.filter !== undefined
      ? new Set(
          analyzeContextRootKeyAccess(matcher.filter, ['jobs']).references.map(
            (reference) => reference.key,
          ),
        )
      : new Set<string>();
  for (const root of roots) allRoots.add(root);
  for (const key of jobKeys) allJobKeys.add(key);
  return {matcher, roots: new Set(roots), jobKeys};
}

function isSnapshotRoot(root: string): root is SnapshotRoot {
  return (
    root === 'run' || root === 'trigger' || root === 'inputs' || root === 'job' || root === 'jobs'
  );
}

async function assembleListenerSnapshotContext(
  tx: Tx,
  params: {
    readonly job: ReturnType<typeof toJob>;
    readonly run: ReturnType<typeof toWorkflowRun>;
    readonly plan: ListenerSnapshotPlan;
  },
): Promise<WorkflowExpressionEvaluationContext> {
  const context: Record<string, unknown> = {};
  if (params.plan.roots.has('run') || params.plan.roots.has('trigger')) {
    const runContext = assembleWorkflowRunContext({
      run: params.run,
      triggerPayload: params.run.triggerPayload,
      inputs: params.run.inputs,
    });
    if (params.plan.roots.has('run')) context.run = runContext.run;
    if (params.plan.roots.has('trigger')) context.trigger = runContext.trigger;
  }

  if (params.plan.roots.has('inputs')) {
    context.inputs = params.run.inputs;
  }
  if (params.plan.roots.has('job')) {
    context.job = {key: params.job.key};
  }
  if (params.plan.roots.has('jobs') && params.plan.jobKeys.size > 0) {
    const dependencyJobs = await getDirectDependencyJobContexts(params.job.id, tx);
    const jobsContext = requestedJobsContext(dependencyJobs, params.plan.jobKeys);
    if (jobsContext !== undefined) context.jobs = jobsContext;
  }

  return context;
}

function requestedJobsContext(
  dependencyJobs: readonly JobContextInput[],
  jobKeys: ReadonlySet<string>,
): unknown {
  const filtered = dependencyJobs.filter(({job}) => jobKeys.has(job.key));
  if (filtered.length === 0) return undefined;

  return assembleJobsContext(filtered).jobs;
}

function applyFilterSnapshots(
  plans: readonly MatcherSnapshotPlan[],
  context: WorkflowExpressionEvaluationContext,
): JobActivatedListenerMatcher[] {
  return plans.map((plan) => {
    const filterSnapshot = filterSnapshotForPlan(plan, context);
    if (filterSnapshot === undefined) return plan.matcher;

    return {...plan.matcher, filter_snapshot: filterSnapshot};
  });
}

function filterSnapshotForPlan(
  plan: MatcherSnapshotPlan,
  context: WorkflowExpressionEvaluationContext,
): Record<string, unknown> | undefined {
  const snapshot: Record<string, unknown> = {};
  for (const root of plan.roots) {
    if (root === 'jobs') {
      const jobsSnapshot = jobsSnapshotForPlan(plan, context);
      if (jobsSnapshot !== undefined) snapshot.jobs = jobsSnapshot;
      continue;
    }

    if (root in context) snapshot[root] = context[root];
  }

  return Object.keys(snapshot).length === 0 ? undefined : snapshot;
}

function jobsSnapshotForPlan(
  plan: MatcherSnapshotPlan,
  context: WorkflowExpressionEvaluationContext,
): Record<string, unknown> | undefined {
  if (plan.jobKeys.size === 0 || typeof context.jobs !== 'object' || context.jobs === null) {
    return undefined;
  }

  const jobsContext = context.jobs as Record<string, unknown>;
  const snapshot = Object.fromEntries(
    [...plan.jobKeys].flatMap((key) => (key in jobsContext ? [[key, jobsContext[key]]] : [])),
  );
  return Object.keys(snapshot).length === 0 ? undefined : snapshot;
}

export type DrainListenerEventsResult =
  | {
      kind: 'execution';
      jobExecutionId: string;
      executionVersion: number;
      sequence: number;
      requiredLabels: string[];
      status: JobExecutionStatus;
    }
  | {kind: 'resolve-requested'}
  | {kind: 'empty'};

export interface DrainListenerEventsParams {
  jobId: string;
  expectedSequence: number;
  maxSize?: number | undefined;
  resolveAgentDefaults?: AgentDefaultsResolver | undefined;
}

export async function drainListenerEventsIntoExecution(
  params: DrainListenerEventsParams,
): Promise<DrainListenerEventsResult> {
  const drained = await db().transaction(async (tx) => {
    const existing = await findExistingExecution(params, tx);
    if (existing) return {result: existing};

    const [resolveEvent] = await tx
      .select({id: jobListenerEvents.id})
      .from(jobListenerEvents)
      .where(
        and(
          eq(jobListenerEvents.jobId, params.jobId),
          eq(jobListenerEvents.disposition, 'resolve'),
          isNull(jobListenerEvents.consumedByExecutionId),
        ),
      )
      .orderBy(asc(jobListenerEvents.receivedAt), asc(jobListenerEvents.id))
      .limit(1)
      .for('update');
    if (resolveEvent) return {result: {kind: 'resolve-requested' as const}};

    const bufferedQuery = tx
      .select()
      .from(jobListenerEvents)
      .where(
        and(
          eq(jobListenerEvents.jobId, params.jobId),
          eq(jobListenerEvents.disposition, 'fire'),
          isNull(jobListenerEvents.consumedByExecutionId),
        ),
      )
      .orderBy(asc(jobListenerEvents.receivedAt), asc(jobListenerEvents.id));
    const bufferedEvents = await (params.maxSize === undefined
      ? bufferedQuery
      : bufferedQuery.limit(params.maxSize)
    ).for('update');
    if (bufferedEvents.length === 0) return {result: {kind: 'empty' as const}};

    const target = await loadListenerMaterializationTarget(params.jobId, tx);
    const triggerEvents = bufferedEvents.map(
      (event): WorkflowExecutionEvent => ({
        source: event.source,
        event: event.event,
        delivery_id: event.deliveryId,
        received_at: event.receivedAt.toISOString(),
        data: event.payload,
      }),
    );

    const fallbackName = `${target.job.key} #${params.expectedSequence}`;
    let executionName = fallbackName;
    let executionNameTrace: ReturnType<typeof resolveJobExecutionName>['trace'] = [];
    let status: JobExecutionStatus = 'pending';
    let materializedSteps: ReturnType<typeof materializeJobExecutionSteps> = [];
    let runner: readonly string[] = [];
    try {
      const model = target.attempt.model;
      if (!model) throw new PermanentListenerMaterializationError('Run attempt has no model');
      const modelJob = model.jobs.find((job) => job.key === target.job.key);
      if (!modelJob) {
        throw new PermanentListenerMaterializationError(
          `Workflow model has no job key: ${target.job.key}`,
        );
      }

      const nameContext = listenerExecutionContext({
        run: toWorkflowRun(target.run),
        jobId: params.jobId,
        sequence: params.expectedSequence,
        executionName,
        status,
        triggerEvents,
        priorExecutions: target.priorExecutions,
      });
      const resolvedExecutionName = resolveJobExecutionName({
        definitionId: target.run.definitionId,
        job: modelJob,
        fallbackName,
        context: nameContext.values,
      });
      executionName = resolvedExecutionName.value;
      executionNameTrace = resolvedExecutionName.trace;
      const stepContext = listenerExecutionContext({
        run: toWorkflowRun(target.run),
        jobId: params.jobId,
        sequence: params.expectedSequence,
        executionName,
        status,
        triggerEvents,
        priorExecutions: target.priorExecutions,
      });
      runner = materializeJobRunner({
        job: modelJob,
        context: stepContext,
        definitionId: target.run.definitionId,
      });
      materializedSteps = materializeJobExecutionSteps({
        model,
        job: modelJob,
        context: stepContext,
        resolveAgentDefaults: params.resolveAgentDefaults ?? catalogDefaultAgentResolver,
        definitionId: target.run.definitionId,
      });
    } catch (error) {
      if (!isPermanentListenerMaterializationError(error)) throw error;
      status = 'failed';
    }

    const [execution] = await tx
      .insert(jobExecutions)
      .values({
        jobId: params.jobId,
        sequence: params.expectedSequence,
        name: executionName,
        runner: runner.length === 0 ? null : [...runner],
        status,
        statusReason: status === 'failed' ? 'unknown' : null,
        triggerEvents,
        evaluationTrace: executionNameTrace.length === 0 ? null : executionNameTrace,
        ...(status === 'failed' ? {finishedAt: sql`now()`} : {}),
      })
      .returning();
    if (!execution) throw new Error('Insert returned no rows');

    await tx
      .update(jobListenerEvents)
      .set({consumedByExecutionId: execution.id})
      .where(
        inArray(
          jobListenerEvents.id,
          bufferedEvents.map((event) => event.id),
        ),
      );

    if (status === 'pending' && materializedSteps.length > 0) {
      await tx.insert(steps).values(
        materializedSteps.map((step) => ({
          jobExecutionId: execution.id,
          key: step.key,
          name: step.name,
          sourceLocation: step.sourceLocation,
          status: step.status,
          type: step.type,
          config: step.config,
          configPlan: step.configPlan ?? null,
          authoredConfig: step.authoredConfig,
          condition: step.condition ?? null,
          position: step.position,
        })),
      );
    }

    if (status === 'failed') {
      recordWorkflowJobExecutionStatusChanged(status);
    }

    return {
      result: {
        kind: 'execution' as const,
        jobExecutionId: execution.id,
        executionVersion: execution.version,
        sequence: execution.sequence,
        requiredLabels: execution.runner ?? [],
        status: execution.status,
      },
      batchSize: bufferedEvents.length,
    };
  });

  if (drained.result.kind === 'execution' && drained.batchSize !== undefined) {
    recordListenerEventsCoalesced(drained.batchSize);
  }

  return drained.result;
}

export interface ListenerBufferPeek {
  fireCount: number;
  resolvePending: boolean;
  oldestAgeMs: number;
  newestAgeMs: number;
}

export async function peekListenerBuffer(params: {jobId: string}): Promise<ListenerBufferPeek> {
  const [row] = await db()
    .select({
      fireCount: sql<number>`count(*) filter (where ${jobListenerEvents.disposition} = 'fire')::integer`,
      resolvePending: sql<boolean>`coalesce(bool_or(${jobListenerEvents.disposition} = 'resolve'), false)`,
      oldestAgeMs: sql<number>`coalesce(floor(extract(epoch from (statement_timestamp() - min(${jobListenerEvents.receivedAt}) filter (where ${jobListenerEvents.disposition} = 'fire'))) * 1000), 0)::integer`,
      newestAgeMs: sql<number>`coalesce(floor(extract(epoch from (statement_timestamp() - max(${jobListenerEvents.receivedAt}) filter (where ${jobListenerEvents.disposition} = 'fire'))) * 1000), 0)::integer`,
    })
    .from(jobListenerEvents)
    .where(
      and(
        eq(jobListenerEvents.jobId, params.jobId),
        isNull(jobListenerEvents.consumedByExecutionId),
      ),
    );

  return {
    fireCount: row?.fireCount ?? 0,
    resolvePending: row?.resolvePending ?? false,
    oldestAgeMs: row?.oldestAgeMs ?? 0,
    newestAgeMs: row?.newestAgeMs ?? 0,
  };
}

export async function resolveJobListener(params: {
  jobId: string;
  reason: ResolutionReason;
}): Promise<{status: 'succeeded' | 'failed'; jobVersion: number}> {
  const result = await db().transaction(async (tx) => {
    const [jobRow] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, params.jobId))
      .limit(1)
      .for('update');
    if (!jobRow) throw new Error(`Job not found: ${params.jobId}`);

    const listenerRows = await tx
      .update(jobs)
      .set({
        listenerStatus: 'resolved',
        resolutionReason: params.reason,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, params.jobId), notInArray(jobs.listenerStatus, ['resolved'])))
      .returning({id: jobs.id});

    const executionRows = await tx
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.jobId, params.jobId))
      .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));
    const {status, statusReason, trace} = evaluateJobSuccess({
      success: jobRow.success,
      executions: executionRows.map(toJobExecution),
    });
    const updated = await updateJobStatusAtVersion(tx, {
      jobId: params.jobId,
      status,
      expectedVersion: jobRow.version,
      statusReason,
      evaluationTrace: trace,
    });
    const job = updated?.job ?? toJob(jobRow);
    const resolvedStatus: 'succeeded' | 'failed' =
      job.status === 'succeeded' ? 'succeeded' : 'failed';
    return {
      status: resolvedStatus,
      jobVersion: job.version,
      changed: listenerRows.length > 0 || updated?.changed === true,
    };
  });

  if (result.changed) recordWorkflowListenerResolved(params.reason);
  return {status: result.status, jobVersion: result.jobVersion};
}

export async function settleListenerJobExecution(params: {
  jobExecutionId: string;
  status: Extract<JobExecutionStatus, 'failed' | 'cancelled'>;
}): Promise<void> {
  const changed = await db().transaction(async (tx) => {
    const [execution] = await tx
      .update(jobExecutions)
      .set({
        status: params.status,
        statusReason: params.status === 'failed' ? 'step_failed' : 'run_cancelled',
        version: sql`${jobExecutions.version} + 1`,
        updatedAt: new Date(),
        finishedAt: sql`now()`,
      })
      .where(
        and(
          eq(jobExecutions.id, params.jobExecutionId),
          notInArray(jobExecutions.status, TERMINAL_EXECUTION_STATUSES),
        ),
      )
      .returning();
    if (!execution) return false;
    await bulkUpdateStepStatuses(
      {jobExecutionId: params.jobExecutionId, status: params.status},
      tx,
    );
    return true;
  });

  if (changed) {
    recordWorkflowJobExecutionStatusChanged(params.status);
  }
}

export async function countActiveListeners(): Promise<number> {
  const [row] = await db()
    .select({value: count()})
    .from(jobs)
    .where(eq(jobs.listenerStatus, 'listening'));
  return row?.value ?? 0;
}

async function findExistingExecution(
  params: DrainListenerEventsParams,
  tx: Tx,
): Promise<Extract<DrainListenerEventsResult, {kind: 'execution'}> | undefined> {
  const [existing] = await tx
    .select()
    .from(jobExecutions)
    .where(
      and(
        eq(jobExecutions.jobId, params.jobId),
        eq(jobExecutions.sequence, params.expectedSequence),
      ),
    )
    .limit(1);
  if (!existing) return undefined;
  return {
    kind: 'execution',
    jobExecutionId: existing.id,
    executionVersion: existing.version,
    sequence: existing.sequence,
    requiredLabels: existing.runner ?? [],
    status: existing.status,
  };
}

async function loadListenerMaterializationTarget(jobId: string, tx: Tx) {
  const [target] = await tx
    .select({job: jobs, attempt: workflowRunAttempts, run: workflowRuns})
    .from(jobs)
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(jobs.id, jobId))
    .limit(1)
    .for('update');
  if (!target) throw new Error(`Job not found: ${jobId}`);

  const priorExecutions = await tx
    .select()
    .from(jobExecutions)
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));
  return {...target, priorExecutions: priorExecutions.map(toJobExecution)};
}

function listenerExecutionContext(params: {
  run: ReturnType<typeof toWorkflowRun>;
  jobId: string;
  sequence: number;
  executionName: string;
  status: JobExecutionStatus;
  triggerEvents: readonly WorkflowExecutionEvent[];
  priorExecutions: ReturnType<typeof toJobExecution>[];
}) {
  return assembleExecutionCreationContext({
    run: params.run,
    triggerPayload: params.run.triggerPayload,
    inputs: params.run.inputs,
    jobId: params.jobId,
    sequence: params.sequence,
    executionName: params.executionName,
    status: params.status,
    triggerEvents: params.triggerEvents,
    priorExecutions: params.priorExecutions,
  });
}

class PermanentListenerMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentListenerMaterializationError';
  }
}

function isPermanentListenerMaterializationError(error: unknown): boolean {
  return (
    error instanceof PermanentListenerMaterializationError ||
    error instanceof InterpolationUnresolvableError ||
    error instanceof InvalidJobRunnerLabelsError ||
    error instanceof AgentConfigUnresolvableError
  );
}
