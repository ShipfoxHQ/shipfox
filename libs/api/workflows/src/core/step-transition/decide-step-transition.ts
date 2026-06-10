import type {RuntimeCompletionStatus} from '../entities/runtime-dag.js';
import type {Step, StepStatus} from '../entities/step.js';

const TERMINAL_STATUSES: ReadonlySet<StepStatus> = new Set(['succeeded', 'failed', 'cancelled']);

export function isTerminal(status: StepStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// Anything other than an all-succeeded job is a failure, so an externally
// cancelled job never reads as a vacuous success.
export function deriveCompletion(steps: Step[]): RuntimeCompletionStatus {
  return steps.every((step) => step.status === 'succeeded') ? 'succeeded' : 'failed';
}

// The result the runner reported for the step being decided.
export interface StepResult {
  status: 'succeeded' | 'failed';
  exitCode?: number | null;
  error?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
}

export interface DecideStepTransitionInput {
  // Full job projection, position-ordered (as returned by getStepsByJobIdForUpdate).
  steps: Step[];
  // The reporting step, already confirmed running at `reportedAttempt`.
  target: Step;
  reportedAttempt: number;
  result: StepResult;
  // PR D injects the gate outcome here; PR E adds the restart attempt cap. Absent
  // ⇒ no gate, so `result.status` is authoritative.
}

// The semantic outcome of a step report, independent of persistence. The restart
// variants are typed now but only produced once durable restart lands (PR E).
export type StepTransitionDecision =
  | {kind: 'complete-step'; stepId: string; attempt: number}
  // The step succeeds and is the last to finish; apply re-derives the job's
  // terminal status from the projection (it may be `failed` if a sibling was
  // cancelled), so the status is not carried on the decision.
  | {kind: 'complete-job'; stepId: string; attempt: number}
  | {kind: 'fail-job'; failedStepId: string; attempt: number; cancelFromPosition: number}
  | {
      kind: 'restart-job-from-step';
      failedStepId: string;
      restartFromStepId: string;
      attempt: number;
      reason: string;
    }
  | {
      kind: 'fail-job-restart-exhausted';
      failedStepId: string;
      attempt: number;
      maxAttempts: number;
    };

// Pure: maps a step report to a transition decision. No DB, no expression engine.
// PR C handles the gate-less cases (the current default behavior); PR D/E extend
// it with gate evaluation and durable restart.
export function decideStepTransition(input: DecideStepTransitionInput): StepTransitionDecision {
  const {steps, target, reportedAttempt, result} = input;

  if (result.status === 'failed') {
    // No gate: a failed step fails the job and cancels the steps after it.
    return {
      kind: 'fail-job',
      failedStepId: target.id,
      attempt: reportedAttempt,
      cancelFromPosition: target.position,
    };
  }

  // Succeeded: completes the job when every other step is already terminal,
  // otherwise just advances this step.
  const everyOtherTerminal = steps
    .filter((step) => step.id !== target.id)
    .every((step) => isTerminal(step.status));
  if (everyOtherTerminal) {
    return {kind: 'complete-job', stepId: target.id, attempt: reportedAttempt};
  }
  return {kind: 'complete-step', stepId: target.id, attempt: reportedAttempt};
}
