import {withTransaction} from '#db/db.js';
import {
  applyStepResult,
  cancelRemainingSteps,
  finishStepAttempt,
  getStepsByJobIdForUpdate,
  insertRunningStepAttempt,
  markStepRunning,
  writeJobCompletedOutbox,
} from '#db/workflow-runs.js';
import type {RuntimeCompletionStatus} from './entities/runtime-dag.js';
import type {Step, StepStatus} from './entities/step.js';
import {
  JobNotFoundError,
  StepAttemptAheadError,
  StepNotFoundError,
  StepNotRunningError,
} from './errors.js';

const TERMINAL_STATUSES: ReadonlySet<StepStatus> = new Set(['succeeded', 'failed', 'cancelled']);

type CompletionStatus = RuntimeCompletionStatus;

function isTerminal(status: StepStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// Anything other than an all-succeeded job is a failure, so an externally
// cancelled job never reads as a vacuous success.
function deriveCompletion(steps: Step[]): CompletionStatus {
  return steps.every((step) => step.status === 'succeeded') ? 'succeeded' : 'failed';
}

export type NextStep = {kind: 'step'; step: Step} | {kind: 'done'; status: CompletionStatus};

export function nextStepForJob(jobId: string): Promise<NextStep> {
  // FOR UPDATE serializes concurrent pulls so a step is never dispatched twice.
  return withTransaction(async (tx) => {
    const steps = await getStepsByJobIdForUpdate(jobId, tx);

    // An unknown or step-less job has nothing to progress; rejecting it stops a
    // bad id from deriving a vacuous 'succeeded' completion below.
    if (steps.length === 0) throw new JobNotFoundError(jobId);

    // Re-deliver the in-flight step rather than advancing, so a retried pull
    // cannot skip a step.
    const running = steps.find((step) => step.status === 'running');
    if (running) return {kind: 'step', step: running};

    const pending = steps.find((step) => step.status === 'pending');
    if (pending) {
      const marked = await markStepRunning({jobId, stepId: pending.id}, tx);
      return {kind: 'step', step: marked ?? pending};
    }

    return {kind: 'done', status: deriveCompletion(steps)};
  });
}

export interface RecordStepResultParams {
  jobId: string;
  stepId: string;
  status: 'succeeded' | 'failed';
  error?: Record<string, unknown> | null;
  // Structured runner output for audit/history on the attempt row. The current
  // step projection keeps status/error only until logs/output have a stable
  // product contract.
  output?: Record<string, unknown> | null;
  // Process exit code reported by the runner (PR B persists it on the attempt).
  exitCode?: number | null;
  // The attempt the runner was dispatched. Omitted = "the step's current
  // attempt" (back-compat for callers that don't track attempts yet).
  attempt?: number;
}

export type RecordStepResultOutcome =
  | {jobFinished: false}
  | {jobFinished: true; status: CompletionStatus};

function outcomeFromSteps(steps: Step[]): RecordStepResultOutcome {
  return steps.every((step) => isTerminal(step.status))
    ? {jobFinished: true, status: deriveCompletion(steps)}
    : {jobFinished: false};
}

export function recordStepResult(params: RecordStepResultParams): Promise<RecordStepResultOutcome> {
  // The failed result and its sibling cancellations are two writes; one
  // transaction keeps them atomic, so a crashed-then-retried report can never
  // leave siblings stranded once the step itself is terminal.
  return withTransaction(async (tx) => {
    const steps = await getStepsByJobIdForUpdate(params.jobId, tx);
    const target = steps.find((step) => step.id === params.stepId);

    if (!target) throw new StepNotFoundError(params.stepId, params.jobId);

    // Attempt-aware idempotency, evaluated before the running/terminal checks and
    // anchored on the step's current attempt (the step_attempts unique constraint
    // is the race backstop).
    const current = target.currentAttempt;
    const reported = params.attempt ?? current;
    if (reported > current) {
      // The host allocates attempts; a runner cannot report one ahead of dispatch.
      throw new StepAttemptAheadError(params.stepId, params.jobId, reported, current);
    }
    if (reported < current) {
      // A stale report from a superseded attempt (e.g. after a rewind bumped the
      // current attempt). No-op: leave the projection untouched.
      return outcomeFromSteps(steps);
    }

    let applied = false;
    if (!isTerminal(target.status)) {
      // A result may only land on a step that was actually handed out.
      if (target.status === 'pending') {
        throw new StepNotRunningError(params.stepId, params.jobId);
      }
      // Migration/back-compat boundary: a running step may predate the
      // step_attempts table or have been marked running by legacy code. Create
      // the audit row just before finalization if dispatch did not already do it.
      await insertRunningStepAttempt(
        {jobId: params.jobId, stepId: params.stepId, attempt: current},
        tx,
      );
      await finishStepAttempt(
        {
          stepId: params.stepId,
          attempt: current,
          status: params.status,
          error: params.error ?? null,
          output: params.output ?? null,
          exitCode: params.exitCode ?? null,
        },
        tx,
      );
      await applyStepResult(
        {
          jobId: params.jobId,
          stepId: params.stepId,
          status: params.status,
          error: params.error ?? null,
        },
        tx,
      );
      if (params.status === 'failed') {
        await cancelRemainingSteps({jobId: params.jobId}, tx);
      }
      applied = true;
    }
    // A terminal target is a duplicate report, left untouched.

    const after = await getStepsByJobIdForUpdate(params.jobId, tx);
    if (after.every((step) => isTerminal(step.status))) {
      const status = deriveCompletion(after);
      // Only this call's transition to terminal emits the completion signal, so
      // a duplicate report on an already-finished job never enqueues a second
      // event (no double signal to the job workflow).
      if (applied) {
        await writeJobCompletedOutbox(tx, {jobId: params.jobId, status});
      }
      return {jobFinished: true, status};
    }
    return {jobFinished: false};
  });
}
