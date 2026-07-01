import type {LogOutcomeDto} from '@shipfox/api-workflows-dto';
import {type Tx, withTransaction} from '#db/db.js';
import {
  countStepAttempts,
  getJobExecutionById,
  getLatestJobExecutionByJobId,
  getStepsByJobExecutionIdForUpdate,
  insertRunningStepAttempt,
  lockActiveJobExecutionLeaseForUpdate,
  markStepRunning,
} from '#db/workflow-runs.js';
import {
  recordWorkflowJobExecutionStepsSettled,
  recordWorkflowStepRestartEnqueued,
} from '#metrics/instance.js';
import type {Step} from './entities/step.js';
import {
  JobLeaseNotActiveError,
  JobNotFoundError,
  StepAttemptAheadError,
  StepNotFoundError,
  StepNotRunningError,
} from './errors.js';
import {
  applyStepTransition,
  type StepProgressionMetrics,
  type StepProgressionOutcome,
} from './step-transition/apply-step-transition.js';
import {
  decideStepTransition,
  deriveCompletion,
  isTerminal,
} from './step-transition/decide-step-transition.js';
import {evaluateGate, gateResultPayload, readStepGate} from './step-transition/evaluate-gate.js';
import type {RuntimeCompletionStatus} from './workflow-runtime/runtime-dag.js';

type CompletionStatus = RuntimeCompletionStatus;

export type NextStep = {kind: 'step'; step: Step} | {kind: 'done'; status: CompletionStatus};

async function nextStepForJobExecutionInTransaction(
  jobExecutionId: string,
  tx: Tx,
): Promise<NextStep> {
  const steps = await getStepsByJobExecutionIdForUpdate(jobExecutionId, tx);

  // An unknown or step-less execution has nothing to progress; rejecting it stops
  // a bad id from deriving a vacuous 'succeeded' completion below.
  if (steps.length === 0) throw new JobNotFoundError(jobExecutionId);

  // Re-deliver the in-flight step rather than advancing, so a retried pull
  // cannot skip a step.
  const running = steps.find((step) => step.status === 'running');
  if (running) return {kind: 'step', step: running};

  const pending = steps.find((step) => step.status === 'pending');
  if (pending) {
    const marked = await markStepRunning({jobExecutionId, stepId: pending.id}, tx);
    return {kind: 'step', step: marked ?? pending};
  }

  return {kind: 'done', status: deriveCompletion(steps)};
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
  // Structured runner output is audit/history on the attempt row; the current
  // step projection keeps only status/error.
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
  const jobExecutionId = params.jobExecutionId;
  // One transaction keeps the attempt finalize, the step result, and any sibling
  // cancellations atomic, so a crashed-then-retried report can never leave
  // siblings stranded once the step itself is terminal.
  const progression = await withTransaction<RecordStepResultTransactionResult>(async (tx) => {
    const jobExecution = await getJobExecutionById(jobExecutionId, tx);
    if (!jobExecution) throw new JobNotFoundError(jobExecutionId);

    const steps = await getStepsByJobExecutionIdForUpdate(jobExecutionId, tx);
    const target = steps.find((step) => step.id === params.stepId);

    if (!target) throw new StepNotFoundError(params.stepId, jobExecutionId);

    // Attempt-aware idempotency, evaluated before the running/terminal checks and
    // anchored on the step's current attempt (the step_attempts unique constraint
    // is the race backstop). These DB-state-dependent guards stay in the service;
    // only the semantic decision below is pure.
    const current = target.currentAttempt;
    const reported = params.attempt ?? current;
    if (reported > current) {
      // The host allocates attempts; a runner cannot report one ahead of dispatch.
      throw new StepAttemptAheadError(params.stepId, jobExecution.jobId, reported, current);
    }
    if (reported < current) {
      // A stale report from a superseded attempt (e.g. after a rewind bumped the
      // current attempt). No-op: leave the projection untouched.
      return {outcome: outcomeFromSteps(steps), metrics: {}};
    }
    // A terminal target is a duplicate report, left untouched.
    if (isTerminal(target.status)) return {outcome: outcomeFromSteps(steps), metrics: {}};
    // A result may only land on a step that was actually handed out.
    if (target.status === 'pending') {
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
    // The restart cap is bounded on the gating step's OWN attempts, not its
    // current_attempt (which a rewind inflates for downstream steps).
    const gatingAttemptCount = gate?.onFailure?.restartFrom
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
    return applyStepTransition(
      decision,
      {
        jobId: jobExecution.jobId,
        jobExecutionId,
        result,
        logOutcome: params.logOutcome ?? 'drained',
        gateResult: gateResultPayload(gateOutcome, result.exitCode),
      },
      tx,
    );
  });

  if (progression.metrics.jobStepsSettledStatus) {
    recordWorkflowJobExecutionStepsSettled(progression.metrics.jobStepsSettledStatus);
  }
  if (progression.metrics.stepRestartEnqueued) recordWorkflowStepRestartEnqueued();

  return progression.outcome;
}
