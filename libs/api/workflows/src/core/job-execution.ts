import {catalogDefaultAgentResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import type {LogOutcomeDto} from '@shipfox/api-workflows-dto';
import {type Tx, withTransaction} from '#db/db.js';
import {
  countStepAttempts,
  dispatchStepWithCompletedConfig,
  finishStepAttempt,
  getJobExecutionById,
  getLatestJobExecutionByJobId,
  getStepAttemptsByJobExecutionId,
  getStepsByJobExecutionIdForUpdate,
  insertRunningStepAttempt,
  lockActiveJobExecutionLeaseForUpdate,
  markStepRunning,
  settleJobFailed,
} from '#db/workflow-runs.js';
import {
  recordWorkflowJobExecutionStepsSettled,
  recordWorkflowStepRestartEnqueued,
} from '#metrics/instance.js';
import type {Step} from './entities/step.js';
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
import type {RuntimeCompletionStatus} from './workflow-scheduling/runtime-dag.js';

type CompletionStatus = RuntimeCompletionStatus;

export type NextStep = {kind: 'step'; step: Step} | {kind: 'done'; status: CompletionStatus};

type DispatchConfigError = InterpolationUnresolvableError | AgentConfigUnresolvableError;

interface PendingStepDispatchParams {
  readonly jobExecutionId: string;
  readonly steps: Step[];
  readonly pending: Step;
  readonly tx: Tx;
}

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

  const pending = steps.find((step) => step.status === 'pending');
  const hasPendingStep = pending !== undefined;
  if (hasPendingStep) return dispatchPendingStep({jobExecutionId, steps, pending, tx});

  return {kind: 'done', status: deriveCompletion(steps)};
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
  steps,
  pending,
  tx,
}: PendingStepDispatchParams): Promise<NextStep> {
  const jobExecution = await getJobExecutionById(jobExecutionId, tx);
  if (!jobExecution) throw new JobNotFoundError(jobExecutionId);

  const attempts = await getStepAttemptsByJobExecutionId(jobExecutionId, tx);
  const context = assembleStepDispatchContext({
    steps,
    attempts,
    targetStepId: pending.id,
    jobExecution,
  });

  try {
    const config = completeStepDispatchConfig({
      step: pending,
      context,
      resolveAgentDefaults: catalogDefaultAgentResolver,
      definitionId: jobExecution.jobId,
    });
    const marked = await dispatchStepWithCompletedConfig(
      {jobExecutionId, stepId: pending.id, config},
      tx,
    );
    return {kind: 'step', step: marked ?? {...pending, config}};
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
    return {kind: 'done', status: 'failed'};
  }
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

  const result = {
    status: params.status,
    error: params.error ?? null,
    output: params.output ?? null,
    exitCode: params.exitCode ?? null,
  };
  // Evaluate the gate (if any) at the service boundary — the only place the CEL
  // engine runs — and pass the precomputed outcome into the pure decision.
  const gate = readStepGate(target.config);
  const gateOutcome = evaluateGate(gate, result);
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

function resolveRestartFeedback(params: {
  decision: StepTransitionDecision;
  gate: ReturnType<typeof readStepGate>;
  result: {
    status: 'succeeded' | 'failed';
    error: Record<string, unknown> | null;
    output: Record<string, unknown> | null;
    exitCode: number | null;
  };
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
