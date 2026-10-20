import {harnessSchema} from '@shipfox/api-agent-dto';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import type {RunnerPlatformDto} from '@shipfox/api-runners-dto';
import type {
  AgentStepSessionDescriptorDto,
  AgentStepSessionIntentDto,
  LogOutcomeDto,
} from '@shipfox/api-workflows-dto';
import {
  coerceKeptStepOutputs,
  coerceStepOutputs,
  evaluatePlannedPredicateAtSite,
  extractExactContextRoots,
  type StepOutputCoercionError,
} from '@shipfox/expression';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {config} from '#config.js';
import {type Tx, withTransaction} from '#db/db.js';
import {
  applyStepResult,
  cancelPendingStep,
  cancelRunningStep,
  countStepAttempts,
  dispatchStepWithCompletedConfig,
  enqueueToolInvocation,
  finishStepAttempt,
  getDirectDependencyJobContexts,
  getJobExecutionById,
  getJobExecutionsByJobId,
  getLatestJobExecutionByJobId,
  getStepAttemptsByJobExecutionId,
  getStepDispatchRunContext,
  getStepsByJobExecutionIdForUpdate,
  getWorkflowContextForJob,
  insertRunningStepAttempt,
  listStoppingStepAttempts,
  markStepRunning,
  markStepSkipped,
  recordJobExecutionActionsDir,
  settleJobFailed,
  settleJobStepsIfDone,
} from '#db/workflow-runs.js';
import {
  recordWorkflowJobExecutionStepsSettled,
  recordWorkflowStepCancelled,
  recordWorkflowStepRestartEnqueued,
  recordWorkflowStepRestartExhausted,
} from '#metrics/instance.js';
import {createAgentDefaultsResolver} from './agent-defaults.js';
import {
  closableComposite,
  compositeAncestorsOf,
  compositeFailed,
  compositeScopeValues,
  earlierSiblingFailed,
  inheritsCompositeConfig,
  openedCompositeAttempt,
  parentStepOf,
  scopedSessionKey,
  sessionScopeOf,
  stepPath,
  stepPathLabel,
  withCompositeConfig,
} from './composite-step.js';
import {
  conditionErrorSummary,
  defaultStepConditionTrace,
  explicitConditionTrace,
  UNFILLABLE_CONDITION_SUMMARY,
} from './condition-trace.js';
import {assertWorkflowProductOutputSize, assertWorkflowStepResultSize} from './diagnostics.js';
import type {JobExecution} from './entities/job-execution.js';
import type {
  PersistedEvaluationTraceEntry,
  Step,
  StepAttempt,
  StepAttemptInvocation,
  StepStatusReason,
} from './entities/step.js';
import {
  ActionInputInvalidError,
  AgentConfigUnresolvableError,
  AgentStepSessionClaimError,
  InterpolationUnresolvableError,
  JobNotFoundError,
  JobOutputTooLargeError,
  StepAttemptAheadError,
  StepNotFoundError,
  StepNotRunningError,
  StepNotStoppingError,
  ToolConfigInvalidError,
  WorkflowExecutionPayloadTooLargeError,
  WorkflowStepResultTooLargeError,
} from './errors.js';
import {claimSessionWithReconciliation} from './session-claim.js';
import {
  completeAgentDefaults,
  readAgentStepSessionIntent,
  restoreAgentSessionIntentForRedispatch,
} from './step-config/agent.js';
import {assembleStepDispatchContext} from './step-config/assemble-run-context.js';
import {
  completeStepDispatchConfig,
  planReadsContext,
} from './step-config/complete-step-dispatch-config.js';
import {completeStepField, completeStepFieldWithType} from './step-config/fields.js';
import {buildPostDispatchConfig, selectPostMainAttempt} from './step-config/post-step.js';
import {readStepRestart} from './step-config/restart-failure-block.js';
import type {WorkflowEvaluationContext} from './step-config/workflow-evaluation-context.js';
import {
  controlStepTargets,
  dispatchBlockers,
  failedWaitTargets,
  holdsAttempt,
  type InFlightStep,
  isHeldByRunner,
  isRunnerStep,
  nextScanAction,
  retryAfterMs,
  type StepScheduling,
  stoppingAttempts,
  TOOL_STEP_RETRY_AFTER_MS,
  withInnerSteps,
} from './step-scheduling.js';
import {
  applyStepTransition,
  type StepProgressionMetrics,
  type StepProgressionOutcome,
} from './step-transition/apply-step-transition.js';
import {
  decideStepTransition,
  deriveCompletion,
  type GateOutcome,
  isTerminal,
  type StepTransitionDecision,
} from './step-transition/decide-step-transition.js';
import {
  evaluateGate,
  evaluateGateFeedback,
  gateResultPayload,
  readStepGate,
  type StepGateRestartRule,
  selectRestartRule,
} from './step-transition/evaluate-gate.js';
import {readStepOutputs} from './step-transition/read-step-outputs.js';
import type {RuntimeCompletionStatus} from './workflow-scheduling/runtime-dag.js';

type CompletionStatus = RuntimeCompletionStatus;

type ReportedStepResult = {
  readonly status: 'succeeded' | 'failed';
  readonly error: Record<string, unknown> | null;
  readonly output: Record<string, unknown> | null;
  readonly response: string | null;
  readonly exitCode: number | null;
  readonly logPath: string | null;
};

export type NextStep =
  | {kind: 'step'; step: Step; dispatched: boolean}
  | {kind: 'wait'; retryAfterMs: number}
  | {kind: 'done'; status: CompletionStatus};

interface PendingSessionClaim {
  readonly kind: 'session-claim';
  readonly jobExecutionId: string;
  readonly jobId: string;
  readonly stepId: string;
  readonly attempt: number;
  readonly stepAttemptId: string | undefined;
  readonly session: AgentStepSessionIntentDto;
  readonly harnessExplicit: boolean;
  readonly config: Record<string, unknown>;
  readonly authoredConfig: Record<string, unknown> | null;
  readonly evaluationTrace: readonly PersistedEvaluationTraceEntry[] | null;
  readonly workflowContext: Awaited<ReturnType<typeof getWorkflowContextForJob>>;
  readonly agent?: AgentInterModuleClient | undefined;
  readonly runnerPlatform?: RunnerPlatformLoader | undefined;
  readonly scheduling: StepScheduling;
}

type NextStepResolution = NextStep | PendingSessionClaim;

/** Reads the platform of the runner that claimed the job. Called only for a step that reads it. */
export type RunnerPlatformLoader = () => Promise<RunnerPlatformDto>;

type DispatchConfigError =
  | InterpolationUnresolvableError
  | AgentConfigUnresolvableError
  | AgentStepSessionClaimError
  | ToolConfigInvalidError
  | ActionInputInvalidError
  | WorkflowExecutionPayloadTooLargeError;

interface PendingStepDispatchParams {
  readonly jobExecutionId: string;
  readonly pending: Step;
  readonly jobExecution: JobExecution;
  readonly context: WorkflowEvaluationContext;
  readonly tx: Tx;
  readonly agent?: AgentInterModuleClient | undefined;
  readonly runnerPlatform?: RunnerPlatformLoader | undefined;
  readonly scheduling: StepScheduling;
  readonly workflowContext: Awaited<ReturnType<typeof getWorkflowContextForJob>>;
  readonly steps: readonly Step[];
  readonly attempts: Awaited<ReturnType<typeof getStepAttemptsByJobExecutionId>>;
  /** What the composite that holds the step resolved when it opened. */
  readonly compositeConfig?: Record<string, unknown> | undefined;
}

interface ResolvePendingStepParams extends ScanContext {
  readonly jobExecutionId: string;
  readonly steps: Step[];
  readonly attempts: Awaited<ReturnType<typeof getStepAttemptsByJobExecutionId>>;
  readonly tx: Tx;
  readonly agent?: AgentInterModuleClient | undefined;
  readonly runnerPlatform?: RunnerPlatformLoader | undefined;
  readonly scheduling: StepScheduling;
}

type StepConditionOutcome =
  | {kind: 'run'}
  | {
      kind: 'skip';
      statusReason: StepStatusReason;
      evaluationTrace: readonly PersistedEvaluationTraceEntry[];
    }
  | {
      kind: 'fail';
      evaluationTrace: readonly PersistedEvaluationTraceEntry[];
      summary: string;
    };

async function nextStepForJobExecutionInTransaction(
  jobExecutionId: string,
  tx: Tx,
  agent?: AgentInterModuleClient | undefined,
  runnerPlatform?: RunnerPlatformLoader | undefined,
  scheduling: StepScheduling = defaultScheduling(),
): Promise<NextStepResolution> {
  const steps = await getStepsByJobExecutionIdForUpdate(jobExecutionId, tx);
  const hasNoSteps = steps.length === 0;

  // An unknown or step-less execution has nothing to progress; rejecting it stops
  // a bad id from deriving a vacuous 'succeeded' completion below.
  if (hasNoSteps) throw new JobNotFoundError(jobExecutionId);

  // A runner that does not hold a stopping attempt can never confirm it, so nothing may wait for
  // it. Finishing the last one can be what settles the job.
  let attempts = await getStepAttemptsByJobExecutionId(jobExecutionId, tx);
  const unheld = stoppingAttempts(attempts).filter(
    (attempt) => !holdsAttempt(scheduling.inFlight, attempt),
  );
  for (const attempt of unheld) {
    await finishStepAttempt(
      {
        stepId: attempt.stepId,
        attempt: attempt.attempt,
        status: 'cancelled',
        logOutcome: 'abandoned',
      },
      tx,
    );
  }
  if (unheld.length > 0) attempts = await getStepAttemptsByJobExecutionId(jobExecutionId, tx);

  // Re-deliver a running step the runner does not hold rather than advancing, so a retried pull
  // cannot skip a step or lose one whose response was lost. A running composite is open on the
  // server, not in flight.
  const undelivered = steps.find(
    (step) =>
      step.status === 'running' && isRunnerStep(step) && !isHeldByRunner(scheduling.inFlight, step),
  );
  if (undelivered !== undefined) {
    return resolveRunningStep(jobExecutionId, undelivered, tx, agent, runnerPlatform, scheduling);
  }

  return scanJobSteps({
    jobExecutionId,
    steps,
    attempts,
    settled: unheld.length > 0,
    context: lazyScanContext(jobExecutionId, tx),
    tx,
    agent,
    runnerPlatform,
    scheduling,
  });
}

function defaultScheduling(): StepScheduling {
  return {inFlight: [], maxConcurrentSteps: config.WORKFLOWS_MAX_CONCURRENT_STEPS};
}

interface ScanContext {
  readonly jobExecution: JobExecution;
  readonly jobs: Awaited<ReturnType<typeof getDirectDependencyJobContexts>>;
  readonly runContext: Awaited<ReturnType<typeof getStepDispatchRunContext>>;
  readonly vars: Record<string, string> | undefined;
  readonly workflowContext: Awaited<ReturnType<typeof getWorkflowContextForJob>>;
}

// A job that only waits on running steps polls often, so the context loads when a step needs it.
function lazyScanContext(jobExecutionId: string, tx: Tx): () => Promise<ScanContext> {
  let loaded: Promise<ScanContext> | undefined;
  return () => {
    loaded ??= (async () => {
      const jobExecution = await getJobExecutionById(jobExecutionId, tx);
      if (!jobExecution) throw new JobNotFoundError(jobExecutionId);
      const jobs = await getDirectDependencyJobContexts(jobExecution.jobId, tx, {
        includeTriggerEventPayloads: false,
      });
      const workflowContext = await getWorkflowContextForJob(jobExecution.jobId, tx);
      const runContext = await getStepDispatchRunContext(jobExecution.jobId, tx);
      return {
        jobExecution,
        jobs,
        runContext,
        vars: workflowContext.vars ?? undefined,
        workflowContext,
      };
    })();
    return loaded;
  };
}

async function resolveRunningStep(
  jobExecutionId: string,
  running: Step,
  tx: Tx,
  agent?: AgentInterModuleClient | undefined,
  runnerPlatform?: RunnerPlatformLoader | undefined,
  scheduling: StepScheduling = defaultScheduling(),
): Promise<NextStepResolution> {
  const session = running.type === 'agent' ? readAgentStepSessionIntent(running.config) : undefined;
  if (session === undefined) return {kind: 'step', step: running, dispatched: false};

  const jobExecution = await getJobExecutionById(jobExecutionId, tx);
  if (!jobExecution) throw new JobNotFoundError(jobExecutionId);

  const attempts = await getStepAttemptsByJobExecutionId(jobExecutionId, tx);
  const currentAttempt = attempts.find(
    (attempt) => attempt.stepId === running.id && attempt.attempt === running.currentAttempt,
  );
  const stepAttemptId =
    currentAttempt?.status === 'running'
      ? currentAttempt.id
      : await insertRunningStepAttempt(
          {
            jobExecutionId,
            stepId: running.id,
            attempt: running.currentAttempt,
            config: running.config,
            evaluationTrace: running.evaluationTrace,
            allowLegacyOversizedDiagnostics: true,
          },
          tx,
        );
  const workflowContext = await getWorkflowContextForJob(jobExecution.jobId, tx);

  return {
    kind: 'session-claim',
    jobExecutionId,
    jobId: jobExecution.jobId,
    stepId: running.id,
    attempt: running.currentAttempt,
    stepAttemptId,
    session,
    harnessExplicit: configHarness(running.authoredConfig ?? {}) !== undefined,
    config: running.config,
    authoredConfig: running.authoredConfig,
    evaluationTrace: currentAttempt?.evaluationTrace ?? running.evaluationTrace,
    workflowContext,
    agent,
    runnerPlatform,
    scheduling,
  };
}

// Walks the steps by position and does the first thing the job needs: dispatch a step, resolve a
// wait or cancel row, skip a step, or tell the runner to wait.
async function scanJobSteps(params: ScanJobStepsParams): Promise<NextStepResolution> {
  const {jobExecutionId, tx} = params;
  let settledAny = params.settled;
  let currentSteps = params.steps;
  let currentAttempts = params.attempts;
  let executions: readonly JobExecution[] | undefined;

  while (true) {
    const closing = closableComposite(currentSteps);
    if (closing !== undefined) {
      const {jobExecution} = await params.context();
      return closeComposite({
        jobExecutionId,
        composite: closing,
        steps: currentSteps,
        attempts: currentAttempts,
        jobExecution,
        tx,
        agent: params.agent,
        runnerPlatform: params.runnerPlatform,
        scheduling: params.scheduling,
      });
    }

    const action = nextScanAction(currentSteps);
    switch (action.kind) {
      case 'blocked':
        return {kind: 'wait', retryAfterMs: retryAfterMs(action.blockers)};
      case 'idle':
        return settleIdleJob(
          {jobExecutionId, steps: currentSteps, attempts: currentAttempts, tx},
          settledAny,
        );
      case 'wait': {
        const joined = await advanceWaitStep({
          step: action.step,
          steps: currentSteps,
          tx,
          jobExecutionId,
        });
        if (joined.kind === 'waiting') {
          return {kind: 'wait', retryAfterMs: retryAfterMs(joined.blockers)};
        }
        settledAny = true;
        break;
      }
      case 'cancel': {
        await advanceCancelStep({
          step: action.step,
          steps: currentSteps,
          scheduling: params.scheduling,
          tx,
          jobExecutionId,
        });
        settledAny = true;
        break;
      }
      case 'pending': {
        const context = await params.context();
        executions = await executionsForStep({
          pending: action.step,
          jobExecution: context.jobExecution,
          executions,
          tx,
        });
        const progress = await progressPendingStep({
          ...params,
          ...context,
          pending: action.step,
          steps: currentSteps,
          attempts: currentAttempts,
          executions,
        });
        if (progress.kind === 'resolved') return progress.resolution;
        currentSteps = progress.steps;
        currentAttempts = progress.attempts;
        settledAny ||= progress.skipped;
        continue;
      }
    }
    currentSteps = await getStepsByJobExecutionIdForUpdate(jobExecutionId, tx);
    currentAttempts = await getStepAttemptsByJobExecutionId(jobExecutionId, tx);
  }
}

interface ScanJobStepsParams {
  readonly jobExecutionId: string;
  /** Whether this call already moved a step to a terminal state. */
  readonly settled: boolean;
  readonly steps: Step[];
  readonly attempts: StepAttempt[];
  readonly context: () => Promise<ScanContext>;
  readonly tx: Tx;
  readonly agent?: AgentInterModuleClient | undefined;
  readonly runnerPlatform?: RunnerPlatformLoader | undefined;
  readonly scheduling: StepScheduling;
}

// Nothing is left to start and no step runs. The job is done once no cancelled process is still
// stopping. The steps-settled event is written once, by the call that made the last step end.
async function settleIdleJob(
  params: {
    readonly jobExecutionId: string;
    readonly steps: readonly Step[];
    readonly attempts: readonly StepAttempt[];
    readonly tx: Tx;
  },
  settledAny: boolean,
): Promise<NextStepResolution> {
  const stopping = stoppingAttempts(params.attempts);
  if (stopping.length > 0) {
    const stoppingIds = new Set(stopping.map((attempt) => attempt.stepId));
    return {
      kind: 'wait',
      retryAfterMs: retryAfterMs(params.steps.filter((step) => stoppingIds.has(step.id))),
    };
  }
  if (settledAny) {
    const {jobId} = await requireJobExecution(params.jobExecutionId, params.tx);
    const status = await settleJobStepsIfDone(
      {jobId, jobExecutionId: params.jobExecutionId},
      params.tx,
    );
    if (status !== null) {
      recordWorkflowJobExecutionStepsSettled(status);
      return {kind: 'done', status};
    }
  }
  return {kind: 'done', status: deriveCompletion([...params.steps])};
}

async function requireJobExecution(jobExecutionId: string, tx: Tx): Promise<JobExecution> {
  const jobExecution = await getJobExecutionById(jobExecutionId, tx);
  if (!jobExecution) throw new JobNotFoundError(jobExecutionId);
  return jobExecution;
}

// A wait row blocks the steps after it until every step it names is terminal. It is re-checked on
// every call. It opens when first reached, so the run page shows how long it blocked.
async function advanceWaitStep(params: {
  readonly step: Step;
  readonly steps: readonly Step[];
  readonly jobExecutionId: string;
  readonly tx: Tx;
}): Promise<{kind: 'joined'} | {kind: 'waiting'; blockers: readonly Step[]}> {
  const {step, jobExecutionId, tx} = params;
  if (step.status === 'pending') await markStepRunning({jobExecutionId, stepId: step.id}, tx);

  const targets = controlStepTargets(step, params.steps);
  const open = targets.filter((target) => !isTerminal(target.status));
  if (open.length > 0) return {kind: 'waiting', blockers: open};

  const failed = failedWaitTargets(targets);
  await finishControlStep(
    {
      jobExecutionId,
      step,
      status: failed.length === 0 ? 'succeeded' : 'failed',
      error: failed.length === 0 ? null : failedWaitError(failed, params.steps),
    },
    tx,
  );
  return {kind: 'joined'};
}

function failedWaitError(failed: readonly Step[], steps: readonly Step[]): Record<string, unknown> {
  const labels = failed.map((step) => `\`${stepLabel(step, steps)}\``).join(', ');
  return {
    message:
      failed.length === 1
        ? `The background step ${labels} failed.`
        : `The background steps ${labels} failed.`,
    source: 'workflows',
  };
}

// A cancel row stops the steps it names and finishes at once, without waiting for them. A target
// that has not started never starts. A running target turns cancelled and, when a runner holds
// it, stays open until the runner confirms its process exited.
async function advanceCancelStep(params: {
  readonly step: Step;
  readonly steps: readonly Step[];
  readonly scheduling: StepScheduling;
  readonly jobExecutionId: string;
  readonly tx: Tx;
}): Promise<void> {
  const {step, jobExecutionId, tx} = params;
  if (step.status === 'pending') await markStepRunning({jobExecutionId, stepId: step.id}, tx);

  let cancelled = 0;
  for (const target of withInnerSteps(controlStepTargets(step, params.steps), params.steps)) {
    if (target.status === 'pending') {
      if (await cancelPendingStep({jobExecutionId, stepId: target.id}, tx)) cancelled += 1;
    } else if (target.status === 'running') {
      const stopped = await cancelRunningStep(
        {
          jobExecutionId,
          stepId: target.id,
          heldByRunner: isRunnerStep(target) && isHeldByRunner(params.scheduling.inFlight, target),
        },
        tx,
      );
      if (stopped !== null) cancelled += 1;
    }
  }
  if (cancelled > 0) recordWorkflowStepCancelled({reason: 'cancel_step', count: cancelled});
  await finishControlStep({jobExecutionId, step, status: 'succeeded', error: null}, tx);
}

// Wait and cancel rows run on the server, so their attempt finishes with the row.
async function finishControlStep(
  params: {
    readonly jobExecutionId: string;
    readonly step: Step;
    readonly status: 'succeeded' | 'failed';
    readonly error: Record<string, unknown> | null;
  },
  tx: Tx,
): Promise<void> {
  await finishStepAttempt(
    {
      stepId: params.step.id,
      attempt: params.step.currentAttempt,
      status: params.status,
      error: params.error,
      logOutcome: 'drained',
    },
    tx,
  );
  await applyStepResult(
    {
      jobExecutionId: params.jobExecutionId,
      stepId: params.step.id,
      status: params.status,
      error: params.error,
    },
    tx,
  );
}

type PendingStepProgress =
  | {readonly kind: 'resolved'; readonly resolution: NextStepResolution}
  | {
      readonly kind: 'continue';
      readonly steps: Step[];
      readonly attempts: StepAttempt[];
      readonly skipped: boolean;
    };

// Decides one pending step: dispatch it, open it when it is a composite, fail it, or skip it.
async function progressPendingStep(
  params: ResolvePendingStepParams & {
    readonly pending: Step;
    readonly attempts: StepAttempt[];
    readonly executions: readonly JobExecution[] | undefined;
  },
): Promise<PendingStepProgress> {
  const {jobExecutionId, pending, steps, attempts, jobExecution, runContext, workflowContext, tx} =
    params;

  // The inner steps of a composite that did not open, or that already failed, never run.
  const composite = parentStepOf(pending, steps);
  if (composite !== undefined && composite.status !== 'running') {
    const skipped = await skipPendingStep({
      jobExecutionId,
      pending,
      steps,
      statusReason: 'composite_skipped',
      evaluationTrace: [],
      tx,
    });
    return {kind: 'continue', steps: skipped, attempts, skipped: true};
  }

  const runner = await stepRunnerPlatform(pending, params.runnerPlatform);
  const context = assembleStepDispatchContext({
    steps,
    attempts,
    targetStepId: pending.id,
    runContext: {
      run: runContext.run,
      triggerPayload: runContext.run.triggerPayload,
      inputs: runContext.run.inputs,
    },
    job: runContext.job,
    jobExecution,
    executions: params.executions,
    jobs: params.jobs,
    vars: params.vars,
    runner,
    ...(composite === undefined
      ? {}
      : {
          scopeValues: compositeScopeValues({
            composite,
            attempts,
            actionsDir: jobExecution.actionsDir,
          }),
        }),
  });
  const condition = pendingStepCondition({pending, steps, attempts, context});

  if (condition.kind === 'run') {
    const blocked = blockedDispatch({pending, steps, attempts, scheduling: params.scheduling});
    if (blocked !== undefined) return {kind: 'resolved', resolution: blocked};

    const dispatchParams: PendingStepDispatchParams = {
      jobExecutionId,
      pending,
      jobExecution,
      context,
      workflowContext,
      tx,
      agent: params.agent,
      runnerPlatform: params.runnerPlatform,
      scheduling: params.scheduling,
      steps,
      attempts,
      compositeConfig:
        composite === undefined
          ? undefined
          : (openedCompositeAttempt(composite, attempts)?.config ?? undefined),
    };
    if (pending.type !== 'composite') {
      return {kind: 'resolved', resolution: await dispatchPendingStep(dispatchParams)};
    }

    // The server opens a composite itself, then goes on with its first inner step.
    const failed = await openComposite(dispatchParams);
    if (failed !== undefined) return {kind: 'resolved', resolution: failed};
    return {
      kind: 'continue',
      steps: await getStepsByJobExecutionIdForUpdate(jobExecutionId, tx),
      attempts: await getStepAttemptsByJobExecutionId(jobExecutionId, tx),
      skipped: false,
    };
  }

  if (condition.kind === 'fail') {
    const resolution = await failPendingStep({
      jobExecutionId,
      pending,
      jobExecution,
      tx,
      agent: params.agent,
      runnerPlatform: params.runnerPlatform,
      scheduling: params.scheduling,
      error: conditionErroredStepError({
        step: pending,
        steps,
        jobKey: workflowContext.jobKey,
        summary: condition.summary,
      }),
      evaluationTrace: condition.evaluationTrace,
    });
    return {kind: 'resolved', resolution};
  }

  const skipped = await skipPendingStep({
    jobExecutionId,
    pending,
    steps,
    statusReason: condition.statusReason,
    evaluationTrace: condition.evaluationTrace,
    tx,
  });
  return {kind: 'continue', steps: skipped, attempts, skipped: true};
}

// A composite is a server-run row and takes no slot. Any other step waits for the stop barrier and
// for a free slot before it starts.
function blockedDispatch(params: {
  readonly pending: Step;
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
  readonly scheduling: StepScheduling;
}): NextStepResolution | undefined {
  if (params.pending.type === 'composite') return undefined;
  const blockers = dispatchBlockers({
    pending: params.pending,
    steps: params.steps,
    attempts: params.attempts,
    maxConcurrentSteps: params.scheduling.maxConcurrentSteps,
  });
  return blockers.length === 0 ? undefined : {kind: 'wait', retryAfterMs: retryAfterMs(blockers)};
}

async function skipPendingStep(params: {
  readonly jobExecutionId: string;
  readonly pending: Step;
  readonly steps: Step[];
  readonly statusReason: StepStatusReason;
  readonly evaluationTrace: readonly PersistedEvaluationTraceEntry[];
  readonly tx: Tx;
}): Promise<Step[]> {
  const {pending} = params;
  const skipped = await markStepSkipped(
    {
      jobExecutionId: params.jobExecutionId,
      stepId: pending.id,
      statusReason: params.statusReason,
      evaluationTrace: params.evaluationTrace,
    },
    params.tx,
  );
  const skippedStep = skipped ?? {
    ...pending,
    status: 'skipped' as const,
    statusReason: params.statusReason,
    evaluationTrace: params.evaluationTrace,
    error: null,
  };
  return params.steps.map((step) => (step.id === pending.id ? skippedStep : step));
}

// Opens a composite in the caller's scope: fills its `with` into typed inputs, and its env and
// working directory, which become the base of its inner steps. Returns the next step only when
// the composite fails to open.
async function openComposite(
  params: PendingStepDispatchParams,
): Promise<NextStepResolution | undefined> {
  const {jobExecutionId, pending, jobExecution, context, tx} = params;
  try {
    const completed = await completeStepDispatchConfig({
      step: pending,
      context,
      definitionId: jobExecution.jobId,
    });
    const config =
      params.compositeConfig === undefined
        ? completed.config
        : withCompositeConfig({
            stepType: pending.type,
            config: completed.config,
            compositeConfig: params.compositeConfig,
          });
    const stepAttemptId = await insertRunningStepAttempt(
      {jobExecutionId, stepId: pending.id, attempt: pending.currentAttempt},
      tx,
    );
    await dispatchStepWithCompletedConfig(
      {
        jobExecutionId,
        stepId: pending.id,
        attempt: pending.currentAttempt,
        stepAttemptId,
        config,
        evaluationTrace: completed.trace,
      },
      tx,
    );
    return undefined;
  } catch (error) {
    const configError = toDispatchConfigError(error);
    if (configError === null) throw error;
    return failPendingStep({
      jobExecutionId,
      pending,
      jobExecution,
      tx,
      agent: params.agent,
      runnerPlatform: params.runnerPlatform,
      scheduling: params.scheduling,
      error: dispatchConfigError(
        configError instanceof InterpolationUnresolvableError
          ? configError.at({
              jobKey: params.workflowContext.jobKey,
              step: {
                key: pending.key ?? undefined,
                name: pending.name,
                index: pending.position,
                line: pending.sourceLocation?.startLine,
              },
            })
          : configError,
      ),
    });
  }
}

async function closeComposite(params: {
  readonly jobExecutionId: string;
  readonly composite: Step;
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
  readonly jobExecution: JobExecution;
  readonly tx: Tx;
  readonly agent?: AgentInterModuleClient | undefined;
  readonly runnerPlatform?: RunnerPlatformLoader | undefined;
  readonly scheduling: StepScheduling;
}): Promise<NextStepResolution> {
  const {jobExecutionId, tx} = params;
  const progression = await recordCompositeResult(params);
  recordStepProgressionMetrics(progression.metrics);
  if (progression.outcome.jobFinished) return {kind: 'done', status: progression.outcome.status};
  return nextStepForJobExecutionInTransaction(
    jobExecutionId,
    tx,
    params.agent,
    params.runnerPlatform,
    params.scheduling,
  );
}

// Closes a composite once its inner steps have finished: it fails when an inner step failed, and
// otherwise fills its outputs from its inner steps. The result then goes through the same path as
// a reported step, so its gate can restart it, and an outer composite it finishes closes too.
function recordCompositeResult(params: {
  readonly jobExecutionId: string;
  readonly composite: Step;
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
  readonly jobExecution: JobExecution;
  readonly tx: Tx;
}): Promise<RecordStepResultTransactionResult> {
  const {composite} = params;
  const outputs = compositeFailed(composite, params.steps)
    ? ({kind: 'failed', error: INNER_STEP_FAILED_ERROR} as const)
    : fillCompositeOutputs(params);
  return recordStepResultInTransaction(
    {
      jobExecutionId: params.jobExecutionId,
      stepId: composite.id,
      attempt: composite.currentAttempt,
      status: outputs.kind === 'filled' ? 'succeeded' : 'failed',
      error: outputs.kind === 'filled' ? null : outputs.error,
      output: outputs.kind === 'filled' ? outputs.output : null,
      logOutcome: 'drained',
    },
    params.tx,
  );
}

// A report that finishes the last inner step closes its composite right away, so the job does not
// depend on the runner pulling again to settle.
async function closeFinishedComposite(params: {
  readonly jobExecutionId: string;
  readonly jobExecution: JobExecution;
  readonly tx: Tx;
}): Promise<RecordStepResultTransactionResult | undefined> {
  const steps = await getStepsByJobExecutionIdForUpdate(params.jobExecutionId, params.tx);
  const composite = closableComposite(steps);
  if (composite === undefined) return undefined;
  const attempts = await getStepAttemptsByJobExecutionId(params.jobExecutionId, params.tx);
  return recordCompositeResult({...params, composite, steps, attempts});
}

const INNER_STEP_FAILED_ERROR = {
  message: 'A step of the composite action failed.',
  source: 'workflows',
};

function fillCompositeOutputs(params: {
  readonly composite: Step;
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
  readonly jobExecution: JobExecution;
}):
  | {readonly kind: 'filled'; readonly output: Record<string, unknown> | null}
  | {readonly kind: 'failed'; readonly error: Record<string, unknown>} {
  const {composite} = params;
  const templates = composite.configPlan?.composite?.outputs ?? {};
  if (Object.keys(templates).length === 0) return {kind: 'filled', output: null};
  const declarations = readStepOutputs(composite.config) ?? {};
  const context = assembleStepDispatchContext({
    steps: params.steps,
    attempts: params.attempts,
    targetStepId: composite.id,
    scopeParentStepId: composite.id,
    scopeValues: compositeScopeValues({
      composite,
      attempts: params.attempts,
      actionsDir: params.jobExecution.actionsDir,
    }),
  });
  const output: Record<string, unknown> = {};
  for (const [name, template] of Object.entries(templates)) {
    const fieldParams = {
      field: 'action.outputs' as const,
      errorField: 'action.outputs' as const,
      template: {segments: template},
      context,
      definitionId: params.jobExecution.jobId,
    };
    try {
      // Typed outputs keep the value of a whole expression, so a list stays a list.
      output[name] =
        (declarations[name]?.type ?? 'string') === 'string'
          ? completeStepField(fieldParams)
          : completeStepFieldWithType(fieldParams);
    } catch (error) {
      if (!(error instanceof InterpolationUnresolvableError)) throw error;
      return {
        kind: 'failed',
        error: {
          message: `Output "${name}" of the composite action can't be filled: ${error.message}`,
          reason: 'output_invalid',
          field: `outputs.${name}`,
          outputKey: name,
        },
      };
    }
  }
  return {kind: 'filled', output};
}

function pendingStepCondition(params: {
  readonly pending: Step;
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
  readonly context: WorkflowEvaluationContext;
}): StepConditionOutcome {
  if (params.pending.type !== 'post') {
    return evaluateStepCondition({
      step: params.pending,
      steps: params.steps,
      context: params.context,
    });
  }
  // A post runs after every authored step, unless its main entry never reached the runner.
  const start = selectPostMainAttempt({
    post: params.pending,
    steps: params.steps,
    attempts: params.attempts,
  });
  return start.kind === 'run'
    ? {kind: 'run'}
    : {kind: 'skip', statusReason: 'main_not_started', evaluationTrace: []};
}

async function dispatchPendingPostStep({
  jobExecutionId,
  pending,
  context,
  steps,
  attempts,
  tx,
}: PendingStepDispatchParams): Promise<NextStepResolution> {
  const start = selectPostMainAttempt({post: pending, steps, attempts});
  if (start.kind !== 'run') throw new Error(`Post step ${pending.id} has no main attempt to run`);

  const execution = context.values.execution as {failed?: unknown} | undefined;
  const config = buildPostDispatchConfig({
    post: pending,
    mainAttempt: start.mainAttempt,
    mainPosition: start.mainStep.position,
    executionFailed: execution?.failed === true,
  });
  const stepAttemptId = await insertRunningStepAttempt(
    {jobExecutionId, stepId: pending.id, attempt: pending.currentAttempt},
    tx,
  );
  const marked = await dispatchStepWithCompletedConfig(
    {
      jobExecutionId,
      stepId: pending.id,
      attempt: pending.currentAttempt,
      stepAttemptId,
      config,
      evaluationTrace: null,
    },
    tx,
  );
  return {kind: 'step', step: marked ?? {...pending, config}, dispatched: true};
}

async function dispatchPendingStep(params: PendingStepDispatchParams): Promise<NextStepResolution> {
  if (params.pending.type === 'post') return dispatchPendingPostStep(params);

  const pending = pendingStepForDispatch(params.pending);
  const dispatchParams = pending === params.pending ? params : {...params, pending};
  const inheritsComposite =
    params.compositeConfig !== undefined &&
    inheritsCompositeConfig(pending, params.compositeConfig);
  const hasConfigPlan = pending.configPlan !== null || pending.type === 'tool' || inheritsComposite;
  if (hasConfigPlan) return dispatchPendingStepWithConfigPlan(dispatchParams);

  // A fully resolved agent step still carries a session intent in its config.
  // Route it through the claim path even though no other field needs dispatch
  // completion.
  const hasSessionIntent = pending.type === 'agent' && pending.config.session !== undefined;
  if (hasSessionIntent) return dispatchPendingStepWithConfigPlan(dispatchParams);

  // A restarted agent step is told why its gate failed, which completes its prompt at dispatch.
  const isRestartedAgent =
    pending.type === 'agent' && readStepRestart(params.context) !== undefined;
  if (isRestartedAgent) return dispatchPendingStepWithConfigPlan(dispatchParams);

  const marked = await markStepRunning(
    {jobExecutionId: params.jobExecutionId, stepId: pending.id},
    params.tx,
  );
  return {kind: 'step', step: marked ?? pending, dispatched: true};
}

function pendingStepForDispatch(step: Step): Step {
  if (step.type !== 'agent' || step.currentAttempt === 1) return step;

  return {
    ...step,
    config: restoreAgentSessionIntentForRedispatch(step),
  };
}

async function dispatchPendingStepWithConfigPlan({
  jobExecutionId,
  pending,
  jobExecution,
  context,
  workflowContext,
  tx,
  agent,
  runnerPlatform,
  scheduling,
  attempts,
  compositeConfig,
}: PendingStepDispatchParams): Promise<NextStepResolution> {
  try {
    const firstAttempt = attempts.find(
      (attempt) => attempt.stepId === pending.id && attempt.attempt === 1,
    );
    const firstAttemptPrompt = firstAttempt?.config?.prompt;
    const completed = await completeStepDispatchConfig({
      step: pending,
      context,
      resolveAgentDefaults: agent ? createAgentDefaultsResolver(agent, null) : undefined,
      definitionId: jobExecution.jobId,
      firstAttemptPrompt: typeof firstAttemptPrompt === 'string' ? firstAttemptPrompt : undefined,
    });
    const config =
      compositeConfig === undefined
        ? completed.config
        : withCompositeConfig({stepType: pending.type, config: completed.config, compositeConfig});
    const session = completed.sessionIntent;
    const dispatchAt = new Date();

    // Persist the attempt and resolved intent before calling the Agent module. The
    // claim is completed after this Workflows transaction commits, so a rollback
    // cannot leave an Agent lock owned by an attempt that does not exist.
    const stepAttemptId = await insertRunningStepAttempt(
      {
        jobExecutionId,
        stepId: pending.id,
        attempt: pending.currentAttempt,
        invocations: initialToolInvocation(pending.type, dispatchAt),
      },
      tx,
    );
    const marked = await dispatchStepWithCompletedConfig(
      {
        jobExecutionId,
        stepId: pending.id,
        attempt: pending.currentAttempt,
        stepAttemptId,
        config,
        evaluationTrace: completed.trace,
      },
      tx,
    );
    const step = marked ?? {...pending, config};
    if (session !== undefined) {
      return {
        kind: 'session-claim',
        jobExecutionId,
        jobId: jobExecution.jobId,
        stepId: pending.id,
        attempt: pending.currentAttempt,
        stepAttemptId,
        session,
        harnessExplicit: configHarness(pending.authoredConfig ?? {}) !== undefined,
        config: step.config,
        authoredConfig: pending.authoredConfig,
        evaluationTrace: completed.trace,
        workflowContext,
        agent,
        runnerPlatform,
        scheduling,
      };
    }
    if (pending.type === 'tool') {
      return enqueuePendingToolInvocation({
        pending,
        stepAttemptId,
        jobExecutionId,
        workspaceId: workflowContext.workspaceId,
        dueAt: dispatchAt,
        tx,
      });
    }
    return {kind: 'step', step, dispatched: true};
  } catch (error) {
    const configError = toDispatchConfigError(error);
    const isConfigError = configError !== null;
    if (!isConfigError) throw error;

    const failureError = dispatchConfigError(
      configError instanceof InterpolationUnresolvableError
        ? configError.at({
            jobKey: workflowContext.jobKey,
            step: {
              key: pending.key ?? undefined,
              name: pending.name,
              index: pending.position,
              line: pending.sourceLocation?.startLine,
            },
          })
        : configError,
    );
    return failPendingStep({
      jobExecutionId,
      pending,
      jobExecution,
      tx,
      agent,
      runnerPlatform,
      scheduling,
      error: failureError,
    });
  }
}

async function failPendingStep(params: {
  readonly jobExecutionId: string;
  readonly pending: Step;
  readonly jobExecution: JobExecution;
  readonly tx: Tx;
  readonly agent?: AgentInterModuleClient | undefined;
  readonly runnerPlatform?: RunnerPlatformLoader | undefined;
  readonly scheduling: StepScheduling;
  readonly error: Record<string, unknown>;
  readonly evaluationTrace?: readonly PersistedEvaluationTraceEntry[] | undefined;
}): Promise<NextStepResolution> {
  const {jobExecutionId, pending, jobExecution, tx, agent, runnerPlatform, scheduling} = params;
  await insertRunningStepAttempt(
    {
      jobExecutionId,
      stepId: pending.id,
      attempt: pending.currentAttempt,
      ...(params.evaluationTrace === undefined ? {} : {evaluationTrace: params.evaluationTrace}),
    },
    tx,
  );
  await finishStepAttempt(
    {
      stepId: pending.id,
      attempt: pending.currentAttempt,
      status: 'failed',
      error: params.error,
      logOutcome: 'abandoned',
    },
    tx,
  );
  const status = await settleJobFailed(tx, {
    jobId: jobExecution.jobId,
    jobExecutionId,
    failedStepId: pending.id,
    error: params.error,
  });
  if (status) recordWorkflowJobExecutionStepsSettled(status);
  return status === null
    ? nextStepForJobExecutionInTransaction(jobExecutionId, tx, agent, runnerPlatform, scheduling)
    : {kind: 'done', status};
}

function initialToolInvocation(
  stepType: Step['type'],
  startedAt: Date,
): readonly StepAttemptInvocation[] | undefined {
  if (stepType !== 'tool') return undefined;
  return [{call_index: 0, started_at: startedAt.toISOString()}];
}

async function enqueuePendingToolInvocation(params: {
  pending: Step;
  stepAttemptId: string | undefined;
  jobExecutionId: string;
  workspaceId: string;
  dueAt: Date;
  tx: Tx;
}): Promise<NextStep> {
  if (params.stepAttemptId === undefined) {
    throw new Error(`Tool step attempt missing after dispatch: ${params.pending.id}`);
  }
  await enqueueToolInvocation(
    {
      stepId: params.pending.id,
      stepAttemptId: params.stepAttemptId,
      jobExecutionId: params.jobExecutionId,
      workspaceId: params.workspaceId,
      dueAt: params.dueAt,
    },
    params.tx,
  );
  return {kind: 'wait', retryAfterMs: TOOL_STEP_RETRY_AFTER_MS};
}

function configHarness(config: Record<string, unknown>): 'pi' | 'claude' | undefined {
  const parsed = harnessSchema.safeParse(config.harness);
  return parsed.success ? parsed.data : undefined;
}

function configString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' ? value : undefined;
}

interface ClaimedStepSession {
  readonly config: Record<string, unknown>;
  readonly sessionId: string | undefined;
}

async function claimStepSessionForDispatch(params: {
  readonly config: Record<string, unknown>;
  readonly stepAttemptId: string | undefined;
  readonly session: AgentStepSessionIntentDto;
  readonly harnessExplicit: boolean;
  readonly authoredConfig: Record<string, unknown> | null;
  readonly workflowContext: Awaited<ReturnType<typeof getWorkflowContextForJob>>;
  readonly agent?: AgentInterModuleClient | undefined;
}): Promise<ClaimedStepSession | null> {
  if (params.session.key.trim().length === 0) {
    throw new AgentStepSessionClaimError(
      'agent_session_key_invalid',
      'Agent session key is invalid',
    );
  }
  if (params.agent === undefined || params.stepAttemptId === undefined) {
    throw new AgentStepSessionClaimError(
      'agent_session_unavailable',
      'Agent session claim is unavailable for this step dispatch',
    );
  }

  const harness = configHarness(params.config);
  if (harness === undefined) {
    throw new AgentStepSessionClaimError(
      'agent_session_unavailable',
      'Agent session claim requires a resolved harness',
    );
  }

  let result: {
    readonly descriptor: AgentStepSessionDescriptorDto | null;
    readonly harness: 'pi' | 'claude';
  } | null;
  try {
    result = await claimSessionWithReconciliation({
      agent: params.agent,
      workspaceId: params.workflowContext.workspaceId,
      projectId: params.workflowContext.projectId,
      workflowRunAttemptId: params.workflowContext.workflowRunAttemptId,
      key: scopedSessionKey(params.session.key, sessionScopeOf(params.config)),
      harness,
      harnessExplicit: params.harnessExplicit,
      stepAttemptId: params.stepAttemptId,
      mode: params.session.mode,
    });
  } catch (error) {
    if (!isInterModuleKnownError(agentInterModuleContract.methods.claimSession, error)) {
      throw error;
    }
    throw new AgentStepSessionClaimError(
      agentSessionClaimReason(error.code),
      agentSessionClaimMessage(error.code),
    );
  }

  if (result === null) return null;

  // A missing fork starts a fresh session and must not leak the authored intent
  // to the runner, which would otherwise try to load a non-existent transcript.
  if (result.descriptor === null) {
    const {session: _session, ...configWithoutSession} = params.config;
    return {config: configWithoutSession, sessionId: undefined};
  }
  const config = await resolveClaimedAgentConfig({
    config: params.config,
    authoredConfig: params.authoredConfig,
    currentHarness: harness,
    pinnedHarness: result.harness,
    harnessExplicit: params.harnessExplicit,
    agent: params.agent,
    workflowContext: params.workflowContext,
  });
  return {
    config: {...config, session: result.descriptor},
    sessionId: result.descriptor.id,
  };
}

async function resolveClaimedAgentConfig(params: {
  readonly config: Record<string, unknown>;
  readonly authoredConfig: Record<string, unknown> | null;
  readonly currentHarness: 'pi' | 'claude';
  readonly pinnedHarness: 'pi' | 'claude';
  readonly harnessExplicit: boolean;
  readonly agent: AgentInterModuleClient;
  readonly workflowContext: Awaited<ReturnType<typeof getWorkflowContextForJob>>;
}): Promise<Record<string, unknown>> {
  if (params.harnessExplicit || params.currentHarness === params.pinnedHarness) {
    return {...params.config, harness: params.pinnedHarness};
  }

  const authoredConfig = params.authoredConfig ?? {};
  const defaults = await completeAgentDefaults({
    harness: params.pinnedHarness,
    provider: Object.hasOwn(authoredConfig, 'provider')
      ? configString(params.config, 'provider')
      : undefined,
    model: Object.hasOwn(authoredConfig, 'model')
      ? configString(params.config, 'model')
      : undefined,
    thinking: Object.hasOwn(authoredConfig, 'thinking')
      ? configString(params.config, 'thinking')
      : undefined,
    resolveAgentDefaults: createAgentDefaultsResolver(
      params.agent,
      params.workflowContext.workspaceId,
    ),
    definitionId: params.workflowContext.jobId,
  });

  return {
    ...params.config,
    harness: defaults.harness,
    provider: defaults.provider,
    model: defaults.model,
    thinking: defaults.thinking,
  };
}

async function completePendingSessionClaim(
  pending: PendingSessionClaim,
): Promise<NextStepResolution> {
  let claimed: ClaimedStepSession | null;
  try {
    // This call deliberately happens after the transaction that persisted the
    // running attempt and authored session intent has committed.
    claimed = await claimStepSessionForDispatch({
      config: pending.config,
      stepAttemptId: pending.stepAttemptId,
      session: pending.session,
      harnessExplicit: pending.harnessExplicit,
      authoredConfig: pending.authoredConfig,
      workflowContext: pending.workflowContext,
      agent: pending.agent,
    });
  } catch (error) {
    const configError = toDispatchConfigError(error);
    if (configError === null) throw error;
    const failureError = dispatchConfigError(configError);
    return withTransaction((tx) => settlePreparedSessionClaimFailure(pending, failureError, tx));
  }

  if (claimed === null) return {kind: 'wait', retryAfterMs: 1000};

  const release = async (): Promise<void> => {
    if (claimed.sessionId === undefined || pending.stepAttemptId === undefined) return;
    await releaseClaim({
      agent: pending.agent,
      sessionId: claimed.sessionId,
      stepAttemptId: pending.stepAttemptId,
    });
  };

  try {
    const resolution = await withTransaction<
      | {readonly kind: 'dispatched'; readonly step: Step}
      | {readonly kind: 'release'; readonly next: NextStepResolution}
    >(async (tx) => {
      if (!(await isCurrentPendingSessionClaim(pending, tx))) {
        return {
          kind: 'release',
          next: await continueAfterStalePendingSessionClaim(pending, tx),
        };
      }

      const marked = await dispatchStepWithCompletedConfig(
        {
          jobExecutionId: pending.jobExecutionId,
          stepId: pending.stepId,
          attempt: pending.attempt,
          stepAttemptId: pending.stepAttemptId,
          config: claimed.config,
          evaluationTrace: pending.evaluationTrace,
        },
        tx,
      );
      if (marked) return {kind: 'dispatched', step: marked};

      // Another terminal transition won the race while the Agent call was in
      // flight. Re-read the durable projection and let the normal progression
      // logic decide whether this job is complete or needs another claim.
      return {
        kind: 'release',
        next: await nextStepForJobExecutionInTransaction(
          pending.jobExecutionId,
          tx,
          pending.agent,
          pending.runnerPlatform,
          pending.scheduling,
        ),
      };
    });

    if (resolution.kind === 'release') {
      await release();
      return resolution.next;
    }
    return {kind: 'step', step: resolution.step, dispatched: true};
  } catch (error) {
    await release();
    const configError = toDispatchConfigError(error);
    if (configError !== null) {
      return withTransaction((tx) =>
        settlePreparedSessionClaimFailure(pending, dispatchConfigError(configError), tx),
      );
    }
    throw error;
  }
}

async function settlePreparedSessionClaimFailure(
  pending: PendingSessionClaim,
  failureError: Record<string, unknown>,
  tx: Tx,
): Promise<NextStepResolution> {
  if (!(await isCurrentPendingSessionClaim(pending, tx))) {
    return continueAfterStalePendingSessionClaim(pending, tx);
  }

  // This is idempotent for a concurrently finalized attempt. If the attempt
  // was never persisted (or was already terminal), settling the step still
  // records the dispatch failure on the current projection.
  await insertRunningStepAttempt(
    {
      jobExecutionId: pending.jobExecutionId,
      stepId: pending.stepId,
      attempt: pending.attempt,
      config: pending.config,
      evaluationTrace: pending.evaluationTrace,
      allowLegacyOversizedDiagnostics: true,
    },
    tx,
  );
  await finishStepAttempt(
    {
      stepId: pending.stepId,
      attempt: pending.attempt,
      status: 'failed',
      error: failureError,
      logOutcome: 'abandoned',
    },
    tx,
  );
  const status = await settleJobFailed(tx, {
    jobId: pending.jobId,
    jobExecutionId: pending.jobExecutionId,
    failedStepId: pending.stepId,
    error: failureError,
  });
  if (status) recordWorkflowJobExecutionStepsSettled(status);
  return status === null
    ? nextStepForJobExecutionInTransaction(
        pending.jobExecutionId,
        tx,
        pending.agent,
        pending.runnerPlatform,
        pending.scheduling,
      )
    : {kind: 'done', status};
}

async function isCurrentPendingSessionClaim(
  pending: PendingSessionClaim,
  tx: Tx,
): Promise<boolean> {
  const steps = await getStepsByJobExecutionIdForUpdate(pending.jobExecutionId, tx);
  const step = steps.find((candidate) => candidate.id === pending.stepId);
  if (step === undefined || step.status !== 'running' || step.currentAttempt !== pending.attempt) {
    return false;
  }
  if (pending.stepAttemptId === undefined) return true;

  const attempts = await getStepAttemptsByJobExecutionId(pending.jobExecutionId, tx);
  const attempt = attempts.find(
    (candidate) => candidate.stepId === pending.stepId && candidate.attempt === pending.attempt,
  );
  return attempt?.id === pending.stepAttemptId && attempt.status === 'running';
}

async function continueAfterStalePendingSessionClaim(
  pending: PendingSessionClaim,
  tx: Tx,
): Promise<NextStepResolution> {
  const steps = await getStepsByJobExecutionIdForUpdate(pending.jobExecutionId, tx);
  const currentStep = steps.find((step) => step.id === pending.stepId);
  // A newer attempt may already be in its own claim window. Return it without
  // re-entering session recovery, which would compete with that claim.
  if (currentStep?.status === 'running') {
    return {kind: 'step', step: currentStep, dispatched: false};
  }
  return nextStepForJobExecutionInTransaction(
    pending.jobExecutionId,
    tx,
    pending.agent,
    pending.runnerPlatform,
    pending.scheduling,
  );
}

function agentSessionClaimReason(
  code:
    | 'session-key-invalid'
    | 'session-held'
    | 'session-harness-mismatch'
    | 'session-lock-unavailable',
): AgentStepSessionClaimError['reason'] {
  switch (code) {
    case 'session-key-invalid':
      return 'agent_session_key_invalid';
    case 'session-held':
      return 'agent_session_held';
    case 'session-harness-mismatch':
      return 'agent_session_harness_mismatch';
    case 'session-lock-unavailable':
      return 'agent_session_unavailable';
  }
}

function agentSessionClaimMessage(
  code:
    | 'session-key-invalid'
    | 'session-held'
    | 'session-harness-mismatch'
    | 'session-lock-unavailable',
): string {
  switch (code) {
    case 'session-key-invalid':
      return 'Agent session key is invalid';
    case 'session-held':
      return 'Agent session is held by another attempt';
    case 'session-harness-mismatch':
      return 'Agent session harness does not match the pinned harness';
    case 'session-lock-unavailable':
      return 'Agent session registry is unavailable';
  }
}

function evaluateStepCondition(params: {
  readonly step: Step;
  readonly steps: readonly Step[];
  readonly context: WorkflowEvaluationContext;
}): StepConditionOutcome {
  const execution = params.context.values.execution as {failed?: unknown} | undefined;
  const failed =
    params.step.parentStepId === null
      ? execution?.failed === true
      : earlierSiblingFailed(params.step, params.steps);
  const {runAfter} = params.step;
  if ((runAfter === 'success' && failed) || (runAfter === 'failure' && !failed)) {
    return {
      kind: 'skip',
      statusReason: 'default_gate_rejected',
      evaluationTrace: defaultStepConditionTrace(runAfter),
    };
  }

  const condition = params.step.condition;
  if (condition === null) return {kind: 'run'};

  const outcome = evaluatePlannedPredicateAtSite({
    expression: condition,
    field: 'step.if',
    site: params.context.site,
    context: params.context.values,
  });
  const evaluationTrace = explicitConditionTrace({
    expression: condition,
    field: 'step.if',
    route: outcome.route,
    site: params.context.site,
    value: outcome.value,
    degraded: outcome.evaluationFailed,
    error: outcome.error,
    values: params.context.values,
  });
  if (outcome.evaluationFailed) {
    return {
      kind: 'fail',
      evaluationTrace,
      summary:
        conditionErrorSummary(evaluationTrace) ??
        outcome.error?.message ??
        UNFILLABLE_CONDITION_SUMMARY,
    };
  }
  return outcome.value
    ? {kind: 'run'}
    : {kind: 'skip', statusReason: 'condition_rejected', evaluationTrace};
}

async function releaseClaim(params: {
  agent: AgentInterModuleClient | undefined;
  sessionId: string;
  stepAttemptId: string;
}): Promise<void> {
  if (params.agent === undefined) return;
  try {
    await params.agent.releaseSession({
      sessionId: params.sessionId,
      stepAttemptId: params.stepAttemptId,
    });
  } catch {
    // Preserve the dispatch failure; stale-claim cleanup remains the fallback.
  }
}

function toDispatchConfigError(error: unknown): DispatchConfigError | null {
  const isInterpolationError = error instanceof InterpolationUnresolvableError;
  if (isInterpolationError) return error;

  const isAgentConfigError = error instanceof AgentConfigUnresolvableError;
  if (isAgentConfigError) return error;

  const isSessionClaimError = error instanceof AgentStepSessionClaimError;
  if (isSessionClaimError) return error;

  const isToolConfigError = error instanceof ToolConfigInvalidError;
  if (isToolConfigError) return error;

  const isActionInputError = error instanceof ActionInputInvalidError;
  if (isActionInputError) return error;

  const isExecutionPayloadError = error instanceof WorkflowExecutionPayloadTooLargeError;
  if (isExecutionPayloadError) return error;

  return null;
}

function interpolationConfigError(error: InterpolationUnresolvableError): Record<string, unknown> {
  return {
    message: error.message,
    reason: 'config_unresolvable',
    field: error.envKey === undefined ? error.field : `${error.field}.${error.envKey}`,
    source: error.source,
    ...(error.summary === undefined ? {} : {summary: error.summary}),
    ...(error.jobKey === undefined ? {} : {jobKey: error.jobKey}),
    ...(error.step === undefined ? {} : {stepIndex: error.step.index}),
  };
}

const TRAILING_PERIOD = /\.$/u;

// Listening jobs can hold many executions, so load them only for a step that reads them.
async function executionsForStep(params: {
  readonly pending: Step;
  readonly jobExecution: JobExecution;
  readonly executions: readonly JobExecution[] | undefined;
  readonly tx: Tx;
}): Promise<readonly JobExecution[] | undefined> {
  if (params.executions !== undefined) return params.executions;
  if (!planReadsContext(params.pending.configPlan, 'executions')) return undefined;
  const jobExecutions = await getJobExecutionsByJobId(params.jobExecution.jobId, params.tx);
  return jobExecutions.filter((execution) => execution.sequence <= params.jobExecution.sequence);
}

// Loaded only for a step that reads `runner`. The loader of a leased request reads the session once.
async function stepRunnerPlatform(
  step: Step,
  load: RunnerPlatformLoader | undefined,
): Promise<RunnerPlatformDto | undefined> {
  if (!stepReadsContext(step, 'runner')) return undefined;
  return await load?.();
}

function stepReadsContext(step: Step, root: string): boolean {
  if (planReadsContext(step.configPlan, root)) return true;
  return step.condition !== null && extractExactContextRoots(step.condition.source).includes(root);
}

function conditionErroredStepError(params: {
  readonly step: Step;
  readonly steps: readonly Step[];
  readonly jobKey: string;
  readonly summary: string;
}): Record<string, unknown> {
  const label = stepLabel(params.step, params.steps);
  return {
    message: `The \`if\` of step \`${label}\` can't be evaluated: ${params.summary.replace(TRAILING_PERIOD, '')}.`,
    reason: 'condition_errored',
    field: 'step.if',
    source: 'workflows',
    summary: params.summary,
    jobKey: params.jobKey,
    stepIndex: params.step.position,
  };
}

// Two uses of one composite hold inner steps with the same key, so a message names the whole path.
function stepLabel(step: Step, steps: readonly Step[]): string {
  return stepPathLabel(stepPath(step, compositeAncestorsOf(step, steps)));
}

function dispatchConfigError(error: DispatchConfigError): Record<string, unknown> {
  if (error instanceof InterpolationUnresolvableError) return interpolationConfigError(error);

  if (error instanceof ToolConfigInvalidError) {
    return {
      message: error.message,
      reason: 'agent_config_invalid',
      field: 'tool',
      source: 'tool',
      code: error.code,
      agentConfigIssue: 'step_config_invalid',
    };
  }

  if (error instanceof ActionInputInvalidError) {
    return {
      message: error.message,
      reason: 'action_input_invalid',
      field: `action.with.${error.input}`,
      source: 'action',
      code: error.code,
    };
  }

  if (error instanceof WorkflowExecutionPayloadTooLargeError) {
    return {
      message: error.message,
      reason: 'execution_payload_too_large',
      field: error.field,
      source: 'workflows',
      code: 'workflow_execution_payload_too_large',
      retryable: false,
      limitBytes: error.limitBytes,
      measuredBytes: error.measuredBytes,
      overshootBytes: error.overshootBytes,
    };
  }

  if (error instanceof AgentStepSessionClaimError) {
    return {
      message: error.message,
      reason: error.reason,
      field: 'agent.session',
      source: 'agent',
    };
  }

  const isManagedProviderPolicyFailure =
    error.code === 'workspace-providers-disabled' && error.managedProviderId !== undefined;
  return {
    message: error.message,
    reason: isManagedProviderPolicyFailure ? 'agent_config_invalid' : 'config_unresolvable',
    field: 'agent',
    source: 'agent',
    ...(error.code === undefined ? {} : {code: error.code}),
    ...(error.managedProviderId === undefined ? {} : {managedProviderId: error.managedProviderId}),
    ...(isManagedProviderPolicyFailure ? {agentConfigIssue: 'provider_unsupported'} : {}),
  };
}

export interface NextStepForLeasedJobExecutionParams {
  jobExecutionId: string;
  agent?: AgentInterModuleClient | undefined;
  runnerPlatform?: RunnerPlatformLoader | undefined;
  /** The step attempts the runner is executing. A runner that sends none holds none. */
  inFlight?: readonly InFlightStep[] | undefined;
  /** Overrides `WORKFLOWS_MAX_CONCURRENT_STEPS`. */
  maxConcurrentSteps?: number | undefined;
}

export type LeasedNextStep = NextStep & {
  /** Steps the runner holds that a cancel step stopped. Derived on every call. */
  cancelStepIds: string[];
};

export async function nextStepForLeasedJobExecution(
  params: NextStepForLeasedJobExecutionParams,
): Promise<LeasedNextStep> {
  const runnerPlatform = params.runnerPlatform && memoize(params.runnerPlatform);
  const scheduling: StepScheduling = {
    inFlight: params.inFlight ?? [],
    maxConcurrentSteps: params.maxConcurrentSteps ?? config.WORKFLOWS_MAX_CONCURRENT_STEPS,
  };
  let cancelStepIds: string[] = [];
  const next = await resolveNextStepWithSessionClaims(() =>
    withTransaction(async (tx) => {
      const resolution = await nextStepForJobExecutionInTransaction(
        params.jobExecutionId,
        tx,
        params.agent,
        runnerPlatform,
        scheduling,
      );
      cancelStepIds = await stoppingStepIds(params.jobExecutionId, scheduling, tx);
      return resolution;
    }),
  );
  return {...next, cancelStepIds};
}

// Read in the scan's transaction, so a cancel row that ran in this call is included. A lost
// response loses nothing, because the next call derives the same ids from the stopping attempts.
async function stoppingStepIds(
  jobExecutionId: string,
  scheduling: StepScheduling,
  tx: Tx,
): Promise<string[]> {
  if (scheduling.inFlight.length === 0) return [];
  const stopping = await listStoppingStepAttempts(jobExecutionId, tx);
  const ids = stopping
    .filter((entry) => holdsAttempt(scheduling.inFlight, entry))
    .map((entry) => entry.stepId);
  return [...new Set(ids)];
}

// A session's platform never changes, so one read serves every step resolved in this request.
function memoize(load: RunnerPlatformLoader): RunnerPlatformLoader {
  let loaded: Promise<RunnerPlatformDto> | undefined;
  return () => {
    loaded ??= load();
    return loaded;
  };
}

export function nextStepForJob(
  jobId: string,
  agent?: AgentInterModuleClient | undefined,
): Promise<NextStep> {
  return resolveNextStepWithSessionClaims(() =>
    withTransaction(async (tx) => {
      const jobExecution = await getLatestJobExecutionByJobId(jobId, tx);
      if (!jobExecution) throw new JobNotFoundError(jobId);

      return nextStepForJobExecutionInTransaction(jobExecution.id, tx, agent);
    }),
  );
}

async function resolveNextStepWithSessionClaims(
  resolve: () => Promise<NextStepResolution>,
): Promise<NextStep> {
  let result = await resolve();
  while (result.kind === 'session-claim') {
    result = await completePendingSessionClaim(result);
  }
  return result;
}

export interface RecordStepResultParams {
  jobExecutionId: string;
  stepId: string;
  status: 'succeeded' | 'failed';
  error?: Record<string, unknown> | null;
  // Structured runner output feeds gate predicates and audit/history on the
  // attempt row; the current step projection keeps only status/error.
  output?: Record<string, unknown> | null;
  response?: string | null;
  exitCode?: number | null;
  logPath?: string | null;
  /** Where the runner unpacks action bundles. Reported with the setup step. */
  actionsDir?: string | undefined;
  // The attempt the runner was dispatched. Omitted = "the step's current
  // attempt" (back-compat for callers that don't track attempts yet).
  attempt?: number;
  logOutcome?: LogOutcomeDto;
}

export type RecordStepResultOutcome = StepProgressionOutcome;

interface RecordStepResultTransactionResult {
  outcome: RecordStepResultOutcome;
  metrics: StepProgressionMetrics;
}

function outcomeFromSteps(steps: Step[], hasStopping = false): RecordStepResultOutcome {
  return steps.every((step) => isTerminal(step.status)) && !hasStopping
    ? {jobFinished: true, status: deriveCompletion(steps)}
    : {jobFinished: false};
}

export interface ConfirmStepStoppedParams {
  jobExecutionId: string;
  stepId: string;
  attempt: number;
  output?: Record<string, unknown> | null | undefined;
  response?: string | null | undefined;
  exitCode?: number | null | undefined;
  logPath?: string | null | undefined;
  logOutcome?: LogOutcomeDto | undefined;
}

/**
 * The runner's confirmation that a cancelled step's process exited. The step turned `cancelled`
 * when its cancel row ran, so this finishes the attempt and lets whatever waited for the stop go
 * on. A repeated confirmation finds the attempt finished and changes nothing.
 */
export async function confirmStepStopped(
  params: ConfirmStepStoppedParams,
): Promise<RecordStepResultOutcome> {
  const settlement = await withTransaction(async (tx) => {
    const steps = await getStepsByJobExecutionIdForUpdate(params.jobExecutionId, tx);
    if (!steps.some((step) => step.id === params.stepId)) {
      throw new StepNotFoundError(params.stepId, params.jobExecutionId);
    }

    const attempts = await getStepAttemptsByJobExecutionId(params.jobExecutionId, tx);
    const attempt = attempts.find(
      (candidate) => candidate.stepId === params.stepId && candidate.attempt === params.attempt,
    );
    if (attempt === undefined) throw new StepNotStoppingError(params.stepId, params.attempt);
    if (attempt.status !== 'running') {
      return {outcome: outcomeFromSteps(steps, stoppingAttempts(attempts).length > 0)};
    }
    if (attempt.cancelRequestedAt === null) {
      throw new StepNotStoppingError(params.stepId, params.attempt);
    }

    const jobExecution = await requireJobExecution(params.jobExecutionId, tx);
    return finishStoppedAttempt({...params, jobId: jobExecution.jobId}, tx);
  });
  recordStepProgressionMetrics(settlement.metrics ?? {});
  return settlement.outcome;
}

// Finishes the attempt of a step that a cancel step stopped. Closing the last open piece settles
// the job.
async function finishStoppedAttempt(
  params: ConfirmStepStoppedParams & {jobId: string},
  tx: Tx,
): Promise<{outcome: RecordStepResultOutcome; metrics?: StepProgressionMetrics}> {
  await finishStepAttempt(
    {
      stepId: params.stepId,
      attempt: params.attempt,
      status: 'cancelled',
      output: params.output ?? null,
      response: params.response ?? null,
      exitCode: params.exitCode ?? null,
      logPath: params.logPath ?? null,
      logOutcome: params.logOutcome ?? 'drained',
    },
    tx,
  );
  const status = await settleJobStepsIfDone(
    {jobId: params.jobId, jobExecutionId: params.jobExecutionId},
    tx,
  );
  if (status === null) return {outcome: {jobFinished: false}};
  return {
    outcome: {jobFinished: true, status},
    metrics: {jobStepsSettledStatus: status},
  };
}

// A report for a step that already ended changes nothing, except that a runner whose process
// exited on its own while a cancel step was stopping it still has to close that attempt.
async function recordLateReport(
  params: {
    readonly jobId: string;
    readonly jobExecutionId: string;
    readonly stepId: string;
    readonly attempt: number;
    readonly steps: readonly Step[];
    readonly logOutcome: LogOutcomeDto | undefined;
    readonly logPath: string | null | undefined;
    readonly exitCode: number | null | undefined;
  },
  tx: Tx,
): Promise<RecordStepResultTransactionResult> {
  const attempts = await getStepAttemptsByJobExecutionId(params.jobExecutionId, tx);
  const stopping = stoppingAttempts(attempts);
  const closing = stopping.find(
    (attempt) => attempt.stepId === params.stepId && attempt.attempt === params.attempt,
  );
  if (closing === undefined) {
    return {outcome: outcomeFromSteps([...params.steps], stopping.length > 0), metrics: {}};
  }
  const settlement = await finishStoppedAttempt(params, tx);
  return {outcome: settlement.outcome, metrics: settlement.metrics ?? {}};
}

export async function recordStepResult(
  params: RecordStepResultParams,
  tx?: Tx,
): Promise<RecordStepResultOutcome> {
  const progression = tx
    ? await recordStepResultInTransaction(params, tx)
    : await withTransaction<RecordStepResultTransactionResult>((transaction) =>
        recordStepResultInTransaction(params, transaction),
      );

  if (tx === undefined) recordStepProgressionMetrics(progression.metrics);

  return progression.outcome;
}

export async function recordStepResultInTransaction(
  params: RecordStepResultParams,
  tx: Tx,
): Promise<RecordStepResultTransactionResult> {
  const jobExecutionId = params.jobExecutionId;

  const jobExecution = await getJobExecutionById(jobExecutionId, tx);
  if (!jobExecution) throw new JobNotFoundError(jobExecutionId);

  const steps = await getStepsByJobExecutionIdForUpdate(jobExecutionId, tx);
  const target = steps.find((step) => step.id === params.stepId);
  const hasTargetStep = target !== undefined;

  if (!hasTargetStep) throw new StepNotFoundError(params.stepId, jobExecutionId);

  const current = target.currentAttempt;
  const reported = params.attempt ?? current;
  const reportClassification = classifyReportedStep(target, reported, jobExecution.jobId);
  if (reportClassification instanceof Error) throw reportClassification;
  if (reportClassification === 'noop') {
    return recordLateReport(
      {
        jobId: jobExecution.jobId,
        jobExecutionId,
        stepId: params.stepId,
        attempt: reported,
        steps,
        logOutcome: params.logOutcome,
        logPath: params.logPath,
        exitCode: params.exitCode,
      },
      tx,
    );
  }

  if (target.type === 'setup' && params.actionsDir !== undefined) {
    await recordJobExecutionActionsDir({jobExecutionId, actionsDir: params.actionsDir}, tx);
  }

  // Migration/back-compat boundary: a running step may predate the
  // step_attempts table or have been marked running by legacy code. Create
  // the audit row just before finalization if dispatch did not already do it.
  await insertRunningStepAttempt(
    {
      jobExecutionId,
      stepId: params.stepId,
      attempt: current,
      config: target.config,
      allowLegacyOversizedDiagnostics: true,
    },
    tx,
  );

  const {result, gateEvaluationAllowed} = normalizeReportedStepResult(
    params,
    target.config,
    target.type,
  );
  const transition = await decideReportedStepTransition({
    jobId: jobExecution.jobId,
    stepId: params.stepId,
    steps,
    target,
    reportedAttempt: reported,
    result,
    gateEvaluationAllowed,
    tx,
  });

  const progression = await applyStepTransition(
    transition.decision,
    {
      jobId: jobExecution.jobId,
      jobExecutionId,
      result,
      logOutcome: params.logOutcome ?? 'drained',
      gateResult: transition.gateResult,
    },
    tx,
  );
  if (progression.outcome.jobFinished) return progression;
  const closed = await closeFinishedComposite({jobExecutionId, jobExecution, tx});
  if (closed === undefined) return progression;
  return {outcome: closed.outcome, metrics: {...progression.metrics, ...closed.metrics}};
}

function normalizeReportedStepResult(
  params: RecordStepResultParams,
  config: Record<string, unknown>,
  stepType: Step['type'],
): {result: ReportedStepResult; gateEvaluationAllowed: boolean} {
  const reported: ReportedStepResult = {
    status: params.status,
    error: params.error ?? null,
    output: params.output ?? null,
    response: params.response ?? null,
    exitCode: params.exitCode ?? null,
    logPath: params.logPath ?? null,
  };
  const reportedDiagnostic = findOversizedReportedDiagnostic(reported);
  if (reportedDiagnostic) return failedReportedStepResult(reported, reportedDiagnostic);

  const outputCoercion = coerceReportedStepOutput(config, reported, stepType);
  if (outputCoercion.kind === 'coerced') {
    // Output declarations wrap the runner value in a new object. Validate
    // that persisted representation too; the framed runner payload can be
    // under its transport limit while the JSONB attempt record is not.
    const outputDiagnostic = findOversizedDiagnostic('output', outputCoercion.output);
    if (outputDiagnostic) return failedReportedStepResult(reported, outputDiagnostic);
    return {result: {...reported, output: outputCoercion.output}, gateEvaluationAllowed: true};
  }
  if (outputCoercion.kind === 'failed') {
    return {
      result: {
        status: 'failed',
        error: outputInvalidError(outputCoercion.error),
        output: null,
        response: reported.response,
        exitCode: reported.exitCode,
        logPath: reported.logPath,
      },
      gateEvaluationAllowed: false,
    };
  }
  return {result: reported, gateEvaluationAllowed: true};
}

function findOversizedReportedDiagnostic(
  reported: ReportedStepResult,
): WorkflowStepResultTooLargeError | JobOutputTooLargeError | undefined {
  for (const [field, value] of [
    ['output', reported.output],
    ['response', reported.response],
    ['error', reported.error],
  ] as const) {
    const error = findOversizedDiagnostic(field, value);
    if (error) return error;
  }
  return undefined;
}

function findOversizedDiagnostic(
  field: 'output' | 'response' | 'error',
  value: unknown,
): WorkflowStepResultTooLargeError | JobOutputTooLargeError | undefined {
  try {
    if (field === 'output') {
      assertWorkflowProductOutputSize('output', value);
    } else {
      assertWorkflowStepResultSize(field, value);
    }
  } catch (error) {
    if (
      error instanceof WorkflowStepResultTooLargeError ||
      error instanceof JobOutputTooLargeError
    ) {
      return error;
    }
    throw error;
  }
  return undefined;
}

function failedReportedStepResult(
  reported: ReportedStepResult,
  error: WorkflowStepResultTooLargeError | JobOutputTooLargeError,
): {result: ReportedStepResult; gateEvaluationAllowed: boolean} {
  return {
    result: {
      status: 'failed',
      error: stepResultTooLargeStepError(error),
      output: null,
      response: null,
      exitCode: reported.exitCode,
      logPath: reported.logPath,
    },
    gateEvaluationAllowed: false,
  };
}

async function decideReportedStepTransition(params: {
  readonly jobId: string;
  readonly stepId: string;
  readonly steps: Step[];
  readonly target: Step;
  readonly reportedAttempt: number;
  readonly result: ReportedStepResult;
  readonly gateEvaluationAllowed: boolean;
  readonly tx: Tx;
}): Promise<{decision: StepTransitionDecision; gateResult: Record<string, unknown> | null}> {
  // Evaluate the gate (if any) at the service boundary. This is the only place
  // the CEL engine runs. Pass the precomputed outcome into the pure decision.
  const gate = params.gateEvaluationAllowed ? readStepGate(params.target.config) : undefined;
  const vars =
    gate === undefined
      ? undefined
      : ((await getWorkflowContextForJob(params.jobId, params.tx)).vars ?? undefined);
  const gateOutcome = params.gateEvaluationAllowed
    ? evaluateGate(gate, params.result, vars, {stepType: params.target.type})
    : {kind: 'no-gate' as const};
  // Rules are read only for a failure the gate allows to restart; the pure decision
  // re-checks steps that cannot restart and uncheckable gates.
  const stepFailed =
    gateOutcome.kind === 'failed' ||
    (gateOutcome.kind === 'no-gate' && params.result.status === 'failed');
  const restartSelection = stepFailed
    ? selectRestartRule({gate, result: params.result, vars, step: params.target})
    : undefined;
  const selectedRule = restartSelection?.kind === 'selected' ? restartSelection.rule : undefined;
  // The restart cap is bounded on the gating step's OWN attempts, not its
  // current_attempt (which a rewind inflates for downstream steps).
  const gatingAttemptCount = selectedRule
    ? await countStepAttempts(params.stepId, params.tx)
    : undefined;
  const decision = decideStepTransition({
    steps: params.steps,
    target: params.target,
    reportedAttempt: params.reportedAttempt,
    result: params.result,
    gateOutcome,
    ...(selectedRule ? {gateOnFailure: selectedRule} : {}),
    ...(selectedRule?.maxAttempts !== undefined ? {maxAttempts: selectedRule.maxAttempts} : {}),
    ...(gatingAttemptCount !== undefined ? {gatingAttemptCount} : {}),
  });
  const gateResult = gateResultPayload(gateOutcome, params.result.exitCode, restartSelection);
  try {
    assertWorkflowStepResultSize('gate_result', gateResult);
  } catch (error) {
    if (!(error instanceof WorkflowStepResultTooLargeError)) throw error;
    return {
      decision: {
        kind: 'fail-job',
        failedStepId: params.stepId,
        attempt: params.reportedAttempt,
        failureError: stepResultTooLargeStepError(error),
      },
      gateResult: null,
    };
  }
  return {
    decision: resolveRestartFeedback({
      decision,
      rule: selectedRule,
      result: params.result,
      gate: gateOutcome,
      definitionId: params.jobId,
      vars,
    }),
    gateResult,
  };
}

type OutputCoercionResult =
  | {kind: 'not-applicable'}
  | {kind: 'coerced'; output: Record<string, unknown>}
  | {kind: 'failed'; error: StepOutputCoercionError};

export type ReportedStepClassification = 'proceed' | 'noop' | Error;

export function classifyReportedStep(
  target: Step,
  reportedAttempt: number,
  jobId: string,
): ReportedStepClassification {
  const currentAttempt = target.currentAttempt;
  if (reportedAttempt > currentAttempt) {
    return new StepAttemptAheadError(target.id, jobId, reportedAttempt, currentAttempt);
  }

  if (reportedAttempt < currentAttempt) return 'noop';
  if (isTerminal(target.status)) return 'noop';
  if (target.status === 'pending') return new StepNotRunningError(target.id, jobId);
  return 'proceed';
}

function coerceReportedStepOutput(
  config: Record<string, unknown>,
  result: ReportedStepResult,
  stepType: Step['type'],
): OutputCoercionResult {
  const declarations = readStepOutputs(config);
  // Tool steps and composite actions report typed values from expressions, not runner text,
  // so a string that looks like JSON must stay a string.
  const parseJsonText = stepType !== 'tool' && stepType !== 'composite';
  if (declarations === undefined) return {kind: 'not-applicable'};
  if (result.status !== 'succeeded') {
    if (result.output === null) return {kind: 'not-applicable'};
    return {
      kind: 'coerced',
      output: coerceKeptStepOutputs({declarations, output: result.output, parseJsonText}),
    };
  }

  const coerced = coerceStepOutputs({declarations, output: result.output, parseJsonText});
  if (!coerced.ok) return {kind: 'failed', error: coerced.error};
  return {kind: 'coerced', output: coerced.output};
}

function outputInvalidError(error: StepOutputCoercionError): Record<string, unknown> {
  return {
    message: error.message,
    reason: 'output_invalid',
    field: `outputs.${error.key}`,
    outputKey: error.key,
    issue: error.reason,
    ...(error.expectedType === undefined ? {} : {expectedType: error.expectedType}),
    ...(error.schemaError === undefined ? {} : {schemaError: error.schemaError}),
  };
}

function stepResultTooLargeStepError(
  error: WorkflowStepResultTooLargeError | JobOutputTooLargeError,
): Record<string, unknown> {
  const field = error instanceof JobOutputTooLargeError ? 'output' : error.field;
  return {
    message: error.message,
    code: 'step_result_too_large',
    reason: 'step_result_too_large',
    field,
    source: 'workflows',
    retryable: false,
    limitBytes: error.limitBytes,
    measuredBytes: error.measuredBytes,
    overshootBytes: error.overshootBytes,
  };
}

function resolveRestartFeedback(params: {
  decision: StepTransitionDecision;
  rule: StepGateRestartRule | undefined;
  result: ReportedStepResult;
  gate: GateOutcome;
  definitionId: string;
  vars?: Record<string, string> | undefined;
}): StepTransitionDecision {
  if (params.decision.kind !== 'restart-job-from-step') return params.decision;
  if (params.rule === undefined) return params.decision;

  try {
    const feedback = evaluateGateFeedback({
      rule: params.rule,
      result: params.result,
      gate: params.gate,
      definitionId: params.definitionId,
      vars: params.vars,
    });
    assertWorkflowStepResultSize('restart_feedback', feedback);
    return {
      ...params.decision,
      feedback,
    };
  } catch (error) {
    if (error instanceof InterpolationUnresolvableError) {
      return {
        kind: 'fail-job',
        failedStepId: params.decision.failedStepId,
        attempt: params.decision.attempt,
        failureError: dispatchConfigError(error),
      };
    }
    if (error instanceof WorkflowStepResultTooLargeError) {
      return {
        kind: 'fail-job',
        failedStepId: params.decision.failedStepId,
        attempt: params.decision.attempt,
        failureError: stepResultTooLargeStepError(error),
      };
    }
    throw error;
  }
}

export function recordStepProgressionMetrics(metrics: StepProgressionMetrics): void {
  const settledStatus = metrics.jobStepsSettledStatus;
  const hasSettledStatus = settledStatus !== undefined;
  if (hasSettledStatus) recordWorkflowJobExecutionStepsSettled(settledStatus);

  const restartWasEnqueued = metrics.stepRestartEnqueued === true;
  if (restartWasEnqueued) recordWorkflowStepRestartEnqueued();

  const restartWasExhausted = metrics.stepRestartExhausted === true;
  if (restartWasExhausted) recordWorkflowStepRestartExhausted();
}
