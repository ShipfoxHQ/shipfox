import type {LogOutcomeDto} from '@shipfox/api-workflows-dto';
import type {Tx} from '#db/db.js';
import {
  applyStepResult,
  cancelRemainingSteps,
  finishStepAttempt,
  getStepsByJobIdForUpdate,
  rewindStepsToPending,
  writeJobStepsSettledOutbox,
  writeStepRestartEnqueuedOutbox,
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

export interface StepProgressionMetrics {
  jobStepsSettledStatus?: 'succeeded' | 'failed';
  stepRestartEnqueued?: boolean;
}

export interface StepProgressionResult {
  outcome: StepProgressionOutcome;
  metrics: StepProgressionMetrics;
}

export interface ApplyStepTransitionContext {
  jobId: string;
  result: StepResult;
  logOutcome: LogOutcomeDto;
  // Gate evaluation audit payload to record on the attempt, when a gate ran.
  gateResult?: Record<string, unknown> | null;
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
): Promise<StepProgressionResult> {
  switch (decision.kind) {
    case 'complete-step':
    case 'complete-job': {
      // A passing gate makes a step succeed even if the raw command status was
      // 'failed', so the projection error is cleared regardless of the report.
      await finishStepAttempt(
        {
          stepId: decision.stepId,
          attempt: decision.attempt,
          status: 'succeeded',
          output: ctx.result.output ?? null,
          exitCode: ctx.result.exitCode ?? null,
          logOutcome: ctx.logOutcome,
          gateResult: ctx.gateResult ?? null,
        },
        tx,
      );
      await applyStepResult(
        {jobId: ctx.jobId, stepId: decision.stepId, status: 'succeeded', error: null},
        tx,
      );
      break;
    }
    case 'fail-job':
    case 'fail-job-restart-exhausted': {
      await finishStepAttempt(
        {
          stepId: decision.failedStepId,
          attempt: decision.attempt,
          status: 'failed',
          output: ctx.result.output ?? null,
          error: decision.failureError,
          exitCode: ctx.result.exitCode ?? null,
          logOutcome: ctx.logOutcome,
          gateResult: ctx.gateResult ?? null,
        },
        tx,
      );
      await applyStepResult(
        {
          jobId: ctx.jobId,
          stepId: decision.failedStepId,
          status: 'failed',
          error: decision.failureError,
        },
        tx,
      );
      // The just-failed step is terminal, so this cancels only the steps after it.
      await cancelRemainingSteps({jobId: ctx.jobId}, tx);
      break;
    }
    case 'restart-job-from-step': {
      // Record the failed attempt FIRST (audit, with the restart reason), then
      // rewind the projection from restart_from so the prior result is preserved
      // only in the attempt history. All in one transaction with the report.
      await finishStepAttempt(
        {
          stepId: decision.failedStepId,
          attempt: decision.attempt,
          status: 'failed',
          output: ctx.result.output ?? null,
          error: decision.failureError,
          exitCode: ctx.result.exitCode ?? null,
          logOutcome: ctx.logOutcome,
          gateResult: ctx.gateResult ?? null,
          restartReason: decision.reason,
        },
        tx,
      );
      await rewindStepsToPending(
        {jobId: ctx.jobId, fromPosition: decision.restartFromPosition},
        tx,
      );
      await writeStepRestartEnqueuedOutbox(tx, {
        jobId: ctx.jobId,
        failedStepId: decision.failedStepId,
        failedStepAttempt: decision.attempt,
        restartFromStepId: decision.restartFromStepId,
        reason: decision.reason,
      });
      // The job stays running; the next pull re-dispatches restart_from. Do not
      // derive completion or emit a completion event.
      return {outcome: {jobFinished: false}, metrics: {stepRestartEnqueued: true}};
    }
  }

  // Re-derive completion from the post-apply projection so the outcome is robust
  // to the cancel sweep above; emit the steps-settled signal exactly once, here on
  // the applied path.
  const after = await getStepsByJobIdForUpdate(ctx.jobId, tx);
  if (after.every((step) => isTerminal(step.status))) {
    const status = deriveCompletion(after);
    await writeJobStepsSettledOutbox(tx, {jobId: ctx.jobId, status});
    return {
      outcome: {jobFinished: true, status},
      metrics: {jobStepsSettledStatus: status},
    };
  }
  return {outcome: {jobFinished: false}, metrics: {}};
}
