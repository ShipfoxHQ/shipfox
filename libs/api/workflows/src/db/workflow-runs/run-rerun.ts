import {materializedAgentStepConfigSchema} from '@shipfox/api-agent-dto';
import {readPersistedWorkflowModel, type WorkflowModel} from '@shipfox/api-definitions-dto';
import {and, asc, eq, inArray, sql} from 'drizzle-orm';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import {isWorkflowRunTerminal, type WorkflowRun} from '#core/entities/workflow-run.js';
import {
  NoFailedJobsError,
  RunNotTerminalError,
  SourceRunNotFoundError,
  WorkflowRunAttemptMismatchError,
} from '#core/errors.js';
import {restoreAgentSessionIntentForRedispatch} from '#core/step-config/agent.js';
import {assembleCreationContext} from '#core/step-config/assemble-run-context.js';
import {
  type MaterializedWorkflowStep,
  materializeJobExecutionSteps,
} from '#core/step-config/materialize-job-execution-steps.js';
import {deriveJobExecutionRunner} from '#core/workflow-run-creation.js';
import {
  recordWorkflowConcurrencyCancellationOutcome,
  recordWorkflowRunCreated,
} from '#metrics/instance.js';
import {db, type Tx} from '../db.js';
import {writeWorkflowsOutboxEvents} from '../outbox-writes.js';
import {type JobExecutionDb, jobExecutions} from '../schema/job-executions.js';
import {type JobDb, jobs} from '../schema/jobs.js';
import {type StepDb, steps} from '../schema/steps.js';
import {workflowConcurrencyClaims} from '../schema/workflow-concurrency-claims.js';
import {type WorkflowRunAttemptDb, workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {toWorkflowRun, workflowRuns} from '../schema/workflow-runs.js';
import {
  admitWorkflowConcurrencyClaim,
  recordWorkflowConcurrencyAdmissionMetrics,
} from '../workflow-concurrency.js';
import {workflowConcurrencyClaimEvents} from './run-create.js';
import {type MaterializedRunGraphJob, persistMaterializedRunGraph} from './run-graph.js';
import {lockWorkflowRun} from './shared.js';

export interface CreateRerunWorkflowRunParams {
  workflowRunId: string;
  mode: 'all' | 'failed';
  actorUserId: string;
  expectedAttempt?: number | undefined;
}

function assertExpectedAttempt(
  params: CreateRerunWorkflowRunParams,
  sourceRow: typeof workflowRuns.$inferSelect,
): void {
  if (params.expectedAttempt !== undefined && sourceRow.currentAttempt !== params.expectedAttempt) {
    throw new WorkflowRunAttemptMismatchError(sourceRow.id, sourceRow.currentAttempt);
  }
}

function rerunSessionCarryOver(
  sourceAttemptId: string,
  mode: CreateRerunWorkflowRunParams['mode'],
) {
  return mode === 'failed' ? {carryOverFromWorkflowRunAttemptId: sourceAttemptId} : {};
}

export async function createRerunWorkflowRun(
  params: CreateRerunWorkflowRunParams,
): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const {sourceRow, sourceAttemptRow, sourceClaimRow, sourceJobs} = await loadRerunSource(
      params,
      tx,
    );

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
        vars: sourceAttemptRow.vars,
        agentToolMaterialization: sourceAttemptRow.agentToolMaterialization,
      })
      .returning();
    if (!newAttemptRow) throw new Error('Insert returned no rows');

    const sourceGraph = await loadRerunSourceGraph(tx, sourceJobs);

    const runForAttempt = {...toWorkflowRun(sourceRow), currentAttempt: attempt};
    const graphJobs = await materializeRerunGraphJobs({
      mode: params.mode,
      sourceRun: runForAttempt,
      sourceAttempt: sourceAttemptRow,
      sourceJobs,
      ...sourceGraph,
    });
    await persistMaterializedRunGraph(tx, {
      run: runForAttempt,
      workflowRunAttempt: newAttemptRow,
      materializedJobs: graphJobs,
      actorUserId: newAttemptRow.rerunByUserId ?? undefined,
      ...rerunSessionCarryOver(sourceAttemptRow.id, params.mode),
    });

    const concurrencyAdmission = sourceClaimRow
      ? await admitWorkflowConcurrencyClaim({
          workflowRunId: sourceRow.id,
          workflowRunAttemptId: newAttemptRow.id,
          concurrency: {
            group: sourceClaimRow.displayGroup,
            scope: sourceClaimRow.scope,
            cancelInProgress: sourceClaimRow.cancelInProgress,
          },
          sourceClaim: sourceClaimRow,
          tx,
        })
      : undefined;
    if (concurrencyAdmission) {
      await writeWorkflowsOutboxEvents(tx, workflowConcurrencyClaimEvents(concurrencyAdmission));
    }

    return {
      run: toWorkflowRun(
        await finalizeRerunWorkflowRun({
          tx,
          sourceRunId: sourceRow.id,
          attemptId: newAttemptRow.id,
          attempt,
          waiting: concurrencyAdmission?.claim.state === 'waiting',
        }),
      ),
      concurrencyAdmission,
    };
  });

  if (result.concurrencyAdmission !== undefined) {
    recordWorkflowConcurrencyAdmissionMetrics(result.concurrencyAdmission);
    const cancellationRequestCount =
      Number(result.concurrencyAdmission.supersededClaim !== null) +
      Number(result.concurrencyAdmission.holderCancellationJustRequested);
    if (cancellationRequestCount > 0) {
      recordWorkflowConcurrencyCancellationOutcome('requested', cancellationRequestCount);
    }
  }

  recordWorkflowRunCreated(result.run.triggerPayload.provider ?? result.run.triggerSource);

  return result.run;
}

async function finalizeRerunWorkflowRun(params: {
  readonly tx: Tx;
  readonly sourceRunId: string;
  readonly attemptId: string;
  readonly attempt: number;
  readonly waiting: boolean;
}): Promise<typeof workflowRuns.$inferSelect> {
  const [newRunRow] = await params.tx
    .update(workflowRuns)
    .set({
      currentAttempt: params.attempt,
      status: params.waiting ? 'waiting' : 'pending',
      version: sql`${workflowRuns.version} + 1`,
      updatedAt: new Date(),
      startedAt: null,
      finishedAt: null,
    })
    .where(eq(workflowRuns.id, params.sourceRunId))
    .returning();
  if (!newRunRow) throw new Error(`Workflow run missing after rerun: ${params.sourceRunId}`);
  if (!params.waiting) return newRunRow;

  const [newWaitingAttemptRow] = await params.tx
    .update(workflowRunAttempts)
    .set({status: 'waiting', updatedAt: new Date()})
    .where(eq(workflowRunAttempts.id, params.attemptId))
    .returning({id: workflowRunAttempts.id});
  if (!newWaitingAttemptRow) {
    throw new Error(`Workflow run attempt missing while entering waiting: ${params.attemptId}`);
  }
  return newRunRow;
}

async function loadRerunSource(
  params: CreateRerunWorkflowRunParams,
  tx: Tx,
): Promise<{
  readonly sourceRow: typeof workflowRuns.$inferSelect;
  readonly sourceAttemptRow: WorkflowRunAttemptDb;
  readonly sourceClaimRow: typeof workflowConcurrencyClaims.$inferSelect | undefined;
  readonly sourceJobs: readonly JobDb[];
}> {
  const workflowRunId = params.workflowRunId;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workflowRunId}))`);

  const sourceRow = await lockWorkflowRun(workflowRunId, tx);
  if (!sourceRow) throw new SourceRunNotFoundError(workflowRunId);
  assertExpectedAttempt(params, sourceRow);

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
    throw new Error(`Current attempt ${sourceRow.currentAttempt} missing for run ${sourceRow.id}`);
  }
  if (!isWorkflowRunTerminal(sourceAttemptRow.status)) {
    throw new RunNotTerminalError(sourceRow.id);
  }

  const [sourceClaimRow] = await tx
    .select()
    .from(workflowConcurrencyClaims)
    .where(eq(workflowConcurrencyClaims.workflowRunAttemptId, sourceAttemptRow.id))
    .limit(1);
  const sourceJobs = await tx
    .select()
    .from(jobs)
    .where(eq(jobs.workflowRunAttemptId, sourceAttemptRow.id))
    .orderBy(asc(jobs.position), asc(jobs.id));
  const hasFailedJob = sourceJobs.some(
    (job) => job.status === 'failed' || job.status === 'cancelled',
  );
  if (params.mode === 'failed' && !hasFailedJob) {
    throw new NoFailedJobsError(sourceRow.id);
  }

  return {sourceRow, sourceAttemptRow, sourceClaimRow, sourceJobs};
}

async function loadRerunSourceGraph(
  tx: Tx,
  sourceJobs: readonly JobDb[],
): Promise<{
  readonly sourceJobExecutionByJobId: ReadonlyMap<string, JobExecutionDb>;
  readonly sourceJobByJobExecutionId: ReadonlyMap<string, JobDb>;
  readonly sourceSteps: readonly StepDb[];
}> {
  const sourceJobIds = sourceJobs.map((job) => job.id);
  const sourceJobExecutionRows =
    sourceJobIds.length === 0
      ? []
      : await tx
          .select()
          .from(jobExecutions)
          .where(inArray(jobExecutions.jobId, sourceJobIds))
          .orderBy(asc(jobExecutions.jobId), asc(jobExecutions.sequence), asc(jobExecutions.id));
  const sourceJobExecutionByJobId = new Map<string, JobExecutionDb>();
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

  const sourceJobById = new Map(sourceJobs.map((job) => [job.id, job]));
  const sourceJobByJobExecutionId = new Map(
    [...sourceJobExecutionByJobId.entries()].flatMap(([jobId, jobExecution]) => {
      const job = sourceJobById.get(jobId);
      return job ? [[jobExecution.id, job] as const] : [];
    }),
  );

  return {sourceJobExecutionByJobId, sourceJobByJobExecutionId, sourceSteps};
}

function rerunStepConfig(step: StepDb): Record<string, unknown> {
  const config =
    step.type === 'agent' ? restoreAgentSessionIntentForRedispatch(step) : {...step.config};
  const authoredConfig = step.authoredConfig;
  if (authoredConfig?.harness !== undefined) config.harness = authoredConfig.harness;
  return config;
}

interface MaterializeRerunGraphParams {
  readonly mode: CreateRerunWorkflowRunParams['mode'];
  readonly sourceRun: WorkflowRun;
  readonly sourceAttempt: WorkflowRunAttemptDb;
  readonly sourceJobs: readonly JobDb[];
  readonly sourceJobExecutionByJobId: ReadonlyMap<string, JobExecutionDb>;
  readonly sourceJobByJobExecutionId: ReadonlyMap<string, JobDb>;
  readonly sourceSteps: readonly StepDb[];
}

function materializeRerunGraphJobs(
  params: MaterializeRerunGraphParams,
): Promise<readonly MaterializedRunGraphJob[]> {
  const sourceModel =
    params.sourceAttempt.model === null
      ? null
      : readPersistedWorkflowModel(params.sourceAttempt.model);
  const sourceModelJobByKey = new Map((sourceModel?.jobs ?? []).map((job) => [job.key, job]));
  const sourceStepsByJobId = new Map<string, StepDb[]>();
  for (const step of params.sourceSteps) {
    const sourceJob = params.sourceJobByJobExecutionId.get(step.jobExecutionId);
    if (!sourceJob) continue;
    const sourceJobSteps = sourceStepsByJobId.get(sourceJob.id) ?? [];
    sourceJobSteps.push(step);
    sourceStepsByJobId.set(sourceJob.id, sourceJobSteps);
  }

  return Promise.all(
    params.sourceJobs.map((sourceJob) =>
      materializeRerunGraphJob(
        params,
        sourceModel,
        sourceJob,
        sourceModelJobByKey.get(sourceJob.key),
        sourceStepsByJobId.get(sourceJob.id) ?? [],
      ),
    ),
  );
}

async function materializeRerunGraphJob(
  params: MaterializeRerunGraphParams,
  sourceModel: WorkflowModel | null,
  sourceJob: JobDb,
  modelJob: ReturnType<typeof readPersistedWorkflowModel>['jobs'][number] | undefined,
  sourceJobSteps: readonly StepDb[],
): Promise<MaterializedRunGraphJob> {
  const carriedOver = params.mode === 'failed' && sourceJob.status === 'succeeded';
  const modelCheckout = modelJob?.checkout;
  const resolvedModelCheckout = modelCheckout === false ? undefined : modelCheckout;
  const rematerializedSteps = await rematerializeRerunSteps({
    params,
    sourceModel,
    modelJob,
    sourceJobSteps,
    carriedOver,
  });
  const sourceIncludesSetupStep = sourceJobSteps.some((step) => step.type === 'setup');
  const rematerializedStepByPosition = new Map(
    rematerializedSteps.flatMap((step) => {
      if (step.type === 'setup' && !sourceIncludesSetupStep) return [];
      const sourcePosition = sourceIncludesSetupStep ? step.position : step.position - 1;
      return [[sourcePosition, step] as const];
    }),
  );

  return {
    job: {
      key: sourceJob.key,
      name: sourceJob.name,
      mode: sourceJob.mode,
      status: carriedOver ? 'succeeded' : 'pending',
      statusReason: null,
      carriedOver,
      checkoutPersistCredentials:
        resolvedModelCheckout?.persistCredentials ?? sourceJob.checkoutPersistCredentials,
      checkoutPermissionsContents:
        resolvedModelCheckout?.permissions?.contents ?? sourceJob.checkoutPermissionsContents,
      success: sourceJob.success,
      executionTimeoutMs: sourceJob.executionTimeoutMs,
      listeningTimeoutMs: sourceJob.listeningTimeoutMs,
      maxExecutions: sourceJob.maxExecutions,
      onResolve: sourceJob.onResolve,
      batchDebounceMs: sourceJob.batchDebounceMs,
      batchMaxSize: sourceJob.batchMaxSize,
      batchMaxWaitMs: sourceJob.batchMaxWaitMs,
      listenerStatus: 'inactive',
      resolutionReason: null,
      listeningOn: sourceJob.listeningOn ? [...sourceJob.listeningOn] : null,
      listeningUntil: sourceJob.listeningUntil ? [...sourceJob.listeningUntil] : null,
      outputs: carriedOver && sourceJob.outputs ? {...sourceJob.outputs} : null,
      dependencies: [...sourceJob.dependencies],
      runner: sourceJob.runner ? [...sourceJob.runner] : null,
      position: sourceJob.position,
    },
    createExecution: (job) =>
      createRerunJobExecution({params, sourceJob, modelJob, carriedOver, job}),
    createSteps: () =>
      sourceJobSteps.map((step) =>
        materializedRerunStep({
          step,
          carriedOver,
          rematerialized: rematerializedStepByPosition.get(step.position),
        }),
      ),
  };
}

function materializedRerunStep(params: {
  readonly step: StepDb;
  readonly carriedOver: boolean;
  readonly rematerialized: MaterializedWorkflowStep | undefined;
}) {
  let config = rerunStepConfig(params.step);
  if (params.carriedOver) config = {...params.step.config};
  else if (params.rematerialized !== undefined) {
    config = {
      ...(resolvedAgentDefaultsFromSourceStep(params.step) ?? {}),
      ...params.rematerialized.config,
    };
  }

  return {
    key: params.step.key,
    name: params.rematerialized?.name ?? params.step.name,
    sourceLocation: params.step.sourceLocation,
    status: params.carriedOver ? params.step.status : ('pending' as const),
    statusReason: params.carriedOver ? params.step.statusReason : null,
    type: params.step.type,
    config,
    condition: params.step.condition ?? null,
    configPlan:
      params.rematerialized === undefined
        ? params.step.configPlan
        : (params.rematerialized.configPlan ?? null),
    authoredConfig: params.step.authoredConfig,
    error: null,
    position: params.step.position,
    currentAttempt: 1,
  };
}

async function rematerializeRerunSteps(params: {
  readonly params: MaterializeRerunGraphParams;
  readonly sourceModel: WorkflowModel | null;
  readonly modelJob: WorkflowModel['jobs'][number] | undefined;
  readonly sourceJobSteps: readonly StepDb[];
  readonly carriedOver: boolean;
}): Promise<readonly MaterializedWorkflowStep[]> {
  if (
    params.carriedOver ||
    params.sourceModel === null ||
    params.modelJob === undefined ||
    params.modelJob.mode === 'listening'
  ) {
    return [];
  }

  const sourceIncludesSetupStep = params.sourceJobSteps.some((step) => step.type === 'setup');
  const sourceStepByPosition = new Map(params.sourceJobSteps.map((step) => [step.position, step]));
  return await materializeJobExecutionSteps({
    model: params.sourceModel,
    job: params.modelJob,
    context: assembleCreationContext({
      run: params.params.sourceRun,
      triggerPayload: params.params.sourceRun.triggerPayload,
      inputs: params.params.sourceRun.inputs,
      secretInputs: params.params.sourceRun.secretInputs,
      vars: params.params.sourceAttempt.vars ?? undefined,
    }),
    definitionId: params.params.sourceRun.definitionId,
    agentToolSnapshot: params.params.sourceAttempt.agentToolMaterialization,
    resolveAgentDefaultsForStep: (stepPosition) =>
      resolvedAgentDefaultsFromSource(
        sourceStepByPosition.get(sourceIncludesSetupStep ? stepPosition + 1 : stepPosition),
      ),
  });
}

function resolvedAgentDefaultsFromSource(
  step: StepDb | undefined,
): AgentDefaultsResolver | undefined {
  const sourceDefaults = resolvedAgentDefaultsFromSourceStep(step);
  if (sourceDefaults === undefined) return undefined;

  return (input) => {
    const resolved = materializedAgentStepConfigSchema.parse({
      harness: input.harness ?? sourceDefaults.harness,
      provider: input.provider ?? sourceDefaults.provider,
      model: input.model ?? sourceDefaults.model,
      thinking: input.thinking ?? sourceDefaults.thinking,
      prompt: '',
    });
    return {
      harness: resolved.harness,
      provider: resolved.provider,
      model: resolved.model,
      thinking: resolved.thinking,
    };
  };
}

function resolvedAgentDefaultsFromSourceStep(step: StepDb | undefined) {
  if (step?.type !== 'agent') return undefined;

  const parsed = materializedAgentStepConfigSchema.safeParse({
    harness: step.config.harness,
    provider: step.config.provider,
    model: step.config.model,
    thinking: step.config.thinking,
    prompt: '',
  });
  if (!parsed.success) return undefined;

  return {
    harness: parsed.data.harness,
    provider: parsed.data.provider,
    model: parsed.data.model,
    thinking: parsed.data.thinking,
  };
}

function createRerunJobExecution(params: {
  readonly params: MaterializeRerunGraphParams;
  readonly sourceJob: JobDb;
  readonly modelJob: ReturnType<typeof readPersistedWorkflowModel>['jobs'][number] | undefined;
  readonly carriedOver: boolean;
  readonly job: Parameters<NonNullable<MaterializedRunGraphJob['createExecution']>>[0];
}) {
  const {job, sourceJob, carriedOver, modelJob} = params;
  if (job.mode === 'listening') return undefined;

  const sourceExecution = params.params.sourceJobExecutionByJobId.get(sourceJob.id);
  const nameOverride = sourceExecution?.name ?? null;
  const executionName = nameOverride ?? job.name ?? job.key;
  const runner =
    carriedOver || modelJob === undefined
      ? (sourceExecution?.runner ?? job.runner ?? null)
      : deriveJobExecutionRunner({
          run: params.params.sourceRun,
          modelJob,
          jobId: job.id,
          sequence: 1,
          nameOverride,
          executionName,
          jobName: job.name,
          status: 'pending',
        });

  return {
    sequence: 1,
    // Reruns preserve the authored/resolved override, never the
    // effective fallback exposed by the core entity.
    name: nameOverride,
    runner: runner ? [...runner] : null,
    status: carriedOver ? ('succeeded' as const) : ('pending' as const),
    statusReason: null,
    outputs: carriedOver && sourceExecution?.outputs ? {...sourceExecution.outputs} : null,
    ...(carriedOver ? {finishedAt: sql`now()`} : {}),
  };
}
