import type {Tx} from '#db/db.js';
import {
  applyStepResult,
  cancelRemainingSteps,
  finishStepAttempt,
  getStepsByJobIdForUpdate,
  writeJobCompletedOutbox,
} from '#db/workflow-runs.js';
import {
  deriveCompletion,
  isTerminal,
  type StepResult,
  type StepTransitionDecision,
} from './decide-step-transition.js';

export type StepProgressionOutcome =
  | {jobFinished: false}
  | {jobFinished: true; status: 'succeeded' | 'failed'};

export interface ApplyStepTransitionContext {
  jobId: string;
  result: StepResult;
}

// Durable side of the decision: writes the attempt + projection for a transition,
// then derives job completion from the post-apply projection and enqueues the
// completion event in the same transaction. Only called for a running target, so
// every path here is an actual state change (idempotent no-ops are handled by the
// caller before deciding).
export async function applyStepTransition(
  decision: StepTransitionDecision,
  ctx: ApplyStepTransitionContext,
  tx: Tx,
): Promise<StepProgressionOutcome> {
  switch (decision.kind) {
    case 'complete-step':
    case 'complete-job': {
      await finishStepAttempt(
        {
          stepId: decision.stepId,
          attempt: decision.attempt,
          status: 'succeeded',
          output: ctx.result.output ?? null,
          exitCode: ctx.result.exitCode ?? null,
        },
        tx,
      );
      await applyStepResult(
        {jobId: ctx.jobId, stepId: decision.stepId, status: 'succeeded', error: null},
        tx,
      );
      break;
    }
    case 'fail-job': {
      await finishStepAttempt(
        {
          stepId: decision.failedStepId,
          attempt: decision.attempt,
          status: 'failed',
          error: ctx.result.error ?? null,
          output: ctx.result.output ?? null,
          exitCode: ctx.result.exitCode ?? null,
        },
        tx,
      );
      await applyStepResult(
        {
          jobId: ctx.jobId,
          stepId: decision.failedStepId,
          status: 'failed',
          error: ctx.result.error ?? null,
        },
        tx,
      );
      // The just-failed step is terminal, so this cancels only the steps after it.
      await cancelRemainingSteps({jobId: ctx.jobId}, tx);
      break;
    }
    case 'restart-job-from-step':
    case 'fail-job-restart-exhausted':
      // Durable restart lands in PR E.
      throw new Error(`Unsupported step transition: ${decision.kind}`);
  }

  // Re-derive completion from the post-apply projection so the outcome is robust
  // to the cancel sweep above; emit the completion event exactly once, here on
  // the applied path.
  const after = await getStepsByJobIdForUpdate(ctx.jobId, tx);
  if (after.every((step) => isTerminal(step.status))) {
    const status = deriveCompletion(after);
    await writeJobCompletedOutbox(tx, {jobId: ctx.jobId, status});
    return {jobFinished: true, status};
  }
  return {jobFinished: false};
}
