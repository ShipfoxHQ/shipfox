import {catalogDefaultAgentResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import type {LogOutcomeDto} from '@shipfox/api-workflows-dto';
import {
  coerceStepOutputs,
  evaluatePlannedPredicateAtSite,
  type StepOutputCoercionError,
} from '@shipfox/expression';
import {type Tx, withTransaction} from '#db/db.js';
import {
  countStepAttempts,
  dispatchStepWithCompletedConfig,
  finishStepAttempt,
  getDirectDependencyJobContexts,
  getJobExecutionById,
  getLatestJobExecutionByJobId,
  getStepAttemptsByJobExecutionId,
  getStepsByJobExecutionIdForUpdate,
  insertRunningStepAttempt,
  lockActiveJobExecutionLeaseForUpdate,
  markStepRunning,
  markStepSkipped,
  settleJobFailed,
  writeJobStepsSettledOutbox,
} from '#db/workflow-runs.js';
import {
  recordWorkflowJobExecutionStepsSettled,
  recordWorkflowStepRestartEnqueued,
} from '#metrics/instance.js';
import {defaultStepConditionTrace, explicitConditionTrace} from './condition-trace.js';
import type {JobExecution} from './entities/job-execution.js';
import type {PersistedEvaluationTraceEntry, Step, StepStatusReason} from './entities/step.js';
import {
  AgentConfigUnresolvableError,
  InterpolationUnresolvableError,
  JobLeaseNotActiveError,
  JobNotFoundError,
  StepAttemptAheadError,
  StepNotFoundError,
  StepNotRunningError,
} from './errors.js';
import {assembleStepDispatchContext} from './step-config/assemble-run-context.js';
import {completeStepDispatchConfig} from './step-config/complete-step-dispatch-config.js';
import type {WorkflowEvaluationContext} from './step-config/workflow-evaluation-context.js';
import {
  applyStepTransition,
  type StepProgressionMetrics,
  type StepProgressionOutcome,
} from './step-transition/apply-step-transition.js';
import {
  decideStepTransition,
  deriveCompletion,
  isTerminal,
  type StepTransitionDecision,
} from './step-transition/decide-step-transition.js';
import {
  evaluateGate,
  evaluateGateFeedback,
  gateResultPayload,
  readStepGate,
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
};

export type NextStep = {kind: 'step'; step: Step} | {kind: 'done'; status: CompletionStatus};

type DispatchConfigError = InterpolationUnresolvableError | AgentConfigUnresolvableError;

interface PendingStepDispatchParams {
  readonly jobExecutionId: string;
  readonly pending: Step;
  readonly jobExecution: JobExecution;
  readonly context: WorkflowEvaluationContext;
  readonly tx: Tx;
}

type StepConditionOutcome =
  | {kind: 'run'}
  | {
      kind: 'skip';
      statusReason: StepStatusReason;
      evaluationTrace: readonly PersistedEvaluationTraceEntry[];
    };

async function nextStepForJobExecutionInTransaction(
  jobExecutionId: string,
  tx: Tx,
): Promise<NextStep> {
  const steps = await getStepsByJobExecutionIdForUpdate(jobExecutionId, tx);
  const hasNoSteps = steps.length === 0;

  // An unknown or step-less execution has nothing to progress; rejecting it stops
  // a bad id from deriving a vacuous 'succeeded' completion below.
  if (hasNoSteps) throw new JobNotFoundError(jobExecutionId);

  // Re-deliver the in-flight step rather than advancing, so a retried pull
  // cannot skip a step.
  const running = steps.find((step) => step.status === 'running');
  const hasRunningStep = running !== undefined;
  if (hasRunningStep) return {kind: 'step', step: running};

  let currentSteps = steps;
  const firstPending = currentSteps.find((step) => step.status === 'pending');
  const hasPendingStep = firstPending !== undefined;
  if (!hasPendingStep) return {kind: 'done', status: deriveCompletion(currentSteps)};

  const jobExecution = await getJobExecutionById(jobExecutionId, tx);
  if (!jobExecution) throw new JobNotFoundError(jobExecutionId);

  const attempts = await getStepAttemptsByJobExecutionId(jobExecutionId, tx);
  const jobs = await getDirectDependencyJobContexts(jobExecution.jobId, tx);

  let skippedAny = false;
  while (true) {
    const pending = currentSteps.find((step) => step.status === 'pending');
    if (pending === undefined) {
      const status = deriveCompletion(currentSteps);
      if (skippedAny) {
        await writeJobStepsSettledOutbox(tx, {
          jobId: jobExecution.jobId,
          jobExecutionId,
          status,
        });
        recordWorkflowJobExecutionStepsSettled(status);
      }
      return {kind: 'done', status};
    }

    const context = assembleStepDispatchContext({
      steps: currentSteps,
      attempts,
      targetStepId: pending.id,
      jobExecution,
      jobs,
    });
    const condition = evaluateStepCondition({step: pending, context});
    if (condition.kind === 'run') {
      return dispatchPendingStep({jobExecutionId, pending, jobExecution, context, tx});
    }

    const skipped = await markStepSkipped(
      {
        jobExecutionId,
        stepId: pending.id,
        statusReason: condition.statusReason,
        evaluationTrace: condition.evaluationTrace,
      },
      tx,
    );
    const skippedStep = skipped ?? {
      ...pending,
      status: 'skipped' as const,
      statusReason: condition.statusReason,
      evaluationTrace: condition.evaluationTrace,
      error: null,
    };
    currentSteps = currentSteps.map((step) => (step.id === pending.id ? skippedStep : step));
    skippedAny = true;
  }
}

async function dispatchPendingStep(params: PendingStepDispatchParams): Promise<NextStep> {
  const hasConfigPlan = params.pending.configPlan !== null;
  if (hasConfigPlan) return dispatchPendingStepWithConfigPlan(params);

  const marked = await markStepRunning(
    {jobExecutionId: params.jobExecutionId, stepId: params.pending.id},
    params.tx,
  );
  return {kind: 'step', step: marked ?? params.pending};
}

async function dispatchPendingStepWithConfigPlan({
  jobExecutionId,
  pending,
  jobExecution,
  context,
  tx,
}: PendingStepDispatchParams): Promise<NextStep> {
  try {
    const completed = completeStepDispatchConfig({
      step: pending,
      context,
      resolveAgentDefaults: catalogDefaultAgentResolver,
      definitionId: jobExecution.jobId,
    });
    const marked = await dispatchStepWithCompletedConfig(
      {
        jobExecutionId,
        stepId: pending.id,
        config: completed.config,
        evaluationTrace: completed.trace,
      },
      tx,
    );
    return {kind: 'step', step: marked ?? {...pending, config: completed.config}};
  } catch (error) {
    const configError = toDispatchConfigError(error);
    const isConfigError = configError !== null;
    if (!isConfigError) throw error;

    const failureError = dispatchConfigError(configError);
    await insertRunningStepAttempt(
      {
        jobExecutionId,
        stepId: pending.id,
        attempt: pending.currentAttempt,
      },
      tx,
    );
    await finishStepAttempt(
      {
        stepId: pending.id,
        attempt: pending.currentAttempt,
        status: 'failed',
        error: failureError,
        logOutcome: 'abandoned',
      },
      tx,
    );
    const status = await settleJobFailed(tx, {
      jobId: jobExecution.jobId,
      jobExecutionId,
      failedStepId: pending.id,
      error: failureError,
    });
    if (status) recordWorkflowJobExecutionStepsSettled(status);
    return status === null
      ? nextStepForJobExecutionInTransaction(jobExecutionId, tx)
      : {kind: 'done', status};
  }
}

function evaluateStepCondition(params: {
  readonly step: Step;
  readonly context: WorkflowEvaluationContext;
}): StepConditionOutcome {
  const condition = params.step.condition;
  if (condition === null) {
    const execution = params.context.values.execution as {failed?: unknown} | undefined;
    return execution?.failed === true
      ? {
          kind: 'skip',
          statusReason: 'default_gate_rejected',
          evaluationTrace: defaultStepConditionTrace(),
        }
      : {kind: 'run'};
  }

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
  });
  if (outcome.evaluationFailed) {
    return {kind: 'skip', statusReason: 'condition_errored', evaluationTrace};
  }
  return outcome.value
    ? {kind: 'run'}
    : {kind: 'skip', statusReason: 'condition_rejected', evaluationTrace};
}

function toDispatchConfigError(error: unknown): DispatchConfigError | null {
  const isInterpolationError = error instanceof InterpolationUnresolvableError;
  if (isInterpolationError) return error;

  const isAgentConfigError = error instanceof AgentConfigUnresolvableError;
  if (isAgentConfigError) return error;

  return null;
}

function dispatchConfigError(error: DispatchConfigError): Record<string, unknown> {
  if (error instanceof InterpolationUnresolvableError) {
    return {
      message: error.message,
      reason: 'config_unresolvable',
      field: error.envKey === undefined ? error.field : `${error.field}.${error.envKey}`,
      source: error.source,
    };
  }

  return {
    message: error.message,
    reason: 'config_unresolvable',
    field: 'agent',
    source: 'agent',
  };
}

export interface NextStepForLeasedJobExecutionParams {
  jobId: string;
  jobExecutionId: string;
  runnerSessionId: string;
}

export function nextStepForLeasedJobExecution(
  params: NextStepForLeasedJobExecutionParams,
): Promise<NextStep> {
  return withTransaction(async (tx) => {
    const leaseIsActive = await lockActiveJobExecutionLeaseForUpdate(params, tx);
    if (!leaseIsActive) throw new JobLeaseNotActiveError(params.jobExecutionId);

    return nextStepForJobExecutionInTransaction(params.jobExecutionId, tx);
  });
}

export function nextStepForJob(jobId: string): Promise<NextStep> {
  return withTransaction(async (tx) => {
    const jobExecution = await getLatestJobExecutionByJobId(jobId, tx);
    if (!jobExecution) throw new JobNotFoundError(jobId);

    return nextStepForJobExecutionInTransaction(jobExecution.id, tx);
  });
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

function outcomeFromSteps(steps: Step[]): RecordStepResultOutcome {
  return steps.every((step) => isTerminal(step.status))
    ? {jobFinished: true, status: deriveCompletion(steps)}
    : {jobFinished: false};
}

export async function recordStepResult(
  params: RecordStepResultParams,
): Promise<RecordStepResultOutcome> {
  const progression = await withTransaction<RecordStepResultTransactionResult>((tx) =>
    recordStepResultInTransaction(params, tx),
  );

  recordStepProgressionMetrics(progression.metrics);

  return progression.outcome;
}

async function recordStepResultInTransaction(
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

  // Attempt-aware idempotency, evaluated before the running/terminal checks and
  // anchored on the step's current attempt (the step_attempts unique constraint
  // is the race backstop). These DB-state-dependent guards stay in the service;
  // only the semantic decision below is pure.
  const current = target.currentAttempt;
  const reported = params.attempt ?? current;
  const reportIsAhead = reported > current;
  if (reportIsAhead) {
    // The host allocates attempts; a runner cannot report one ahead of dispatch.
    throw new StepAttemptAheadError(params.stepId, jobExecution.jobId, reported, current);
  }

  const reportIsStale = reported < current;
  if (reportIsStale) {
    // A stale report from a superseded attempt (e.g. after a rewind bumped the
    // current attempt). No-op: leave the projection untouched.
    return {outcome: outcomeFromSteps(steps), metrics: {}};
  }

  const targetIsTerminal = isTerminal(target.status);
  // A terminal target is a duplicate report, left untouched.
  if (targetIsTerminal) return {outcome: outcomeFromSteps(steps), metrics: {}};

  const targetIsPending = target.status === 'pending';
  // A result may only land on a step that was actually handed out.
  if (targetIsPending) {
    throw new StepNotRunningError(params.stepId, jobExecution.jobId);
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
    },
    tx,
  );

  let result: ReportedStepResult = {
    status: params.status,
    error: params.error ?? null,
    output: params.output ?? null,
    response: params.response ?? null,
    exitCode: params.exitCode ?? null,
  };
  const outputCoercion = coerceReportedStepOutput(target.config, result);
  if (outputCoercion.kind === 'coerced') {
    result = {...result, output: outputCoercion.output};
  }
  if (outputCoercion.kind === 'failed') {
    result = {
      status: 'failed',
      error: outputInvalidError(outputCoercion.error),
      output: null,
      response: result.response,
      exitCode: result.exitCode,
    };
  }

  // Evaluate the gate (if any) at the service boundary — the only place the CEL
  // engine runs — and pass the precomputed outcome into the pure decision.
  const shouldEvaluateGate = outputCoercion.kind !== 'failed';
  const gate = shouldEvaluateGate ? readStepGate(target.config) : undefined;
  const gateOutcome = shouldEvaluateGate ? evaluateGate(gate, result) : {kind: 'no-gate' as const};
  const hasRestartPolicy = gate?.onFailure?.restartFrom !== undefined;
  // The restart cap is bounded on the gating step's OWN attempts, not its
  // current_attempt (which a rewind inflates for downstream steps).
  const gatingAttemptCount = hasRestartPolicy
    ? await countStepAttempts(params.stepId, tx)
    : undefined;
  const decision = decideStepTransition({
    steps,
    target,
    reportedAttempt: reported,
    result,
    gateOutcome,
    ...(gate?.onFailure ? {gateOnFailure: gate.onFailure} : {}),
    ...(gatingAttemptCount !== undefined ? {gatingAttemptCount} : {}),
  });
  const resolvedDecision = resolveRestartFeedback({
    decision,
    gate,
    result,
    definitionId: jobExecution.jobId,
  });

  return applyStepTransition(
    resolvedDecision,
    {
      jobId: jobExecution.jobId,
      jobExecutionId,
      result,
      logOutcome: params.logOutcome ?? 'drained',
      gateResult: gateResultPayload(gateOutcome, result.exitCode),
    },
    tx,
  );
}

type OutputCoercionResult =
  | {kind: 'not-applicable'}
  | {kind: 'coerced'; output: Record<string, unknown>}
  | {kind: 'failed'; error: StepOutputCoercionError};

function coerceReportedStepOutput(
  config: Record<string, unknown>,
  result: ReportedStepResult,
): OutputCoercionResult {
  if (result.status !== 'succeeded') return {kind: 'not-applicable'};

  const declarations = readStepOutputs(config);
  if (declarations === undefined) return {kind: 'not-applicable'};

  const coerced = coerceStepOutputs({declarations, output: result.output});
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

function resolveRestartFeedback(params: {
  decision: StepTransitionDecision;
  gate: ReturnType<typeof readStepGate>;
  result: ReportedStepResult;
  definitionId: string;
}): StepTransitionDecision {
  if (params.decision.kind !== 'restart-job-from-step') return params.decision;
  if (params.gate === undefined) return params.decision;

  try {
    return {
      ...params.decision,
      feedback: evaluateGateFeedback({
        gate: params.gate,
        result: params.result,
        definitionId: params.definitionId,
      }),
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
    throw error;
  }
}

function recordStepProgressionMetrics(metrics: StepProgressionMetrics): void {
  const settledStatus = metrics.jobStepsSettledStatus;
  const hasSettledStatus = settledStatus !== undefined;
  if (hasSettledStatus) recordWorkflowJobExecutionStepsSettled(settledStatus);

  const restartWasEnqueued = metrics.stepRestartEnqueued === true;
  if (restartWasEnqueued) recordWorkflowStepRestartEnqueued();
}
