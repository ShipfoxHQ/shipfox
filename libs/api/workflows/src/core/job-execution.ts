import {withTransaction} from '#db/db.js';
import {
  applyStepResult,
  cancelRemainingSteps,
  getStepsByJobIdForUpdate,
  markStepRunning,
} from '#db/workflow-runs.js';
import type {RuntimeCompletionStatus} from './entities/runtime-dag.js';
import type {Step, StepStatus} from './entities/step.js';
import {JobNotFoundError, StepNotFoundError, StepNotRunningError} from './errors.js';

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
}

export type RecordStepResultOutcome =
  | {jobFinished: false}
  | {jobFinished: true; status: CompletionStatus};

export function recordStepResult(params: RecordStepResultParams): Promise<RecordStepResultOutcome> {
  // The failed result and its sibling cancellations are two writes; one
  // transaction keeps them atomic, so a crashed-then-retried report can never
  // leave siblings stranded once the step itself is terminal.
  return withTransaction(async (tx) => {
    const steps = await getStepsByJobIdForUpdate(params.jobId, tx);
    const target = steps.find((step) => step.id === params.stepId);

    if (!target) throw new StepNotFoundError(params.stepId, params.jobId);

    if (!isTerminal(target.status)) {
      // A result may only land on a step that was actually handed out.
      if (target.status === 'pending') {
        throw new StepNotRunningError(params.stepId, params.jobId);
      }
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
    }
    // A terminal target is a duplicate report, left untouched.

    const after = await getStepsByJobIdForUpdate(params.jobId, tx);
    if (after.every((step) => isTerminal(step.status))) {
      return {jobFinished: true, status: deriveCompletion(after)};
    }
    return {jobFinished: false};
  });
}
