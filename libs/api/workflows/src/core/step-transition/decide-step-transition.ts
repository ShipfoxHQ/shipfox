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

// Precomputed gate evaluation (the CEL engine runs in evaluate-gate.ts, never
// here). `passed`/`failed` are clean evaluations; `uncheckable` means the gate
// could not be evaluated (no exit code, or an evaluation error) and is treated
// as a plain command failure — never a restart.
export type GateOutcome =
  | {kind: 'no-gate'}
  | {kind: 'passed'; source: string}
  | {kind: 'failed'; source: string}
  | {kind: 'uncheckable'; reason: string};

export interface DecideStepTransitionInput {
  // Full job projection, position-ordered (as returned by getStepsByJobIdForUpdate).
  steps: Step[];
  // The reporting step, already confirmed running at `reportedAttempt`.
  target: Step;
  reportedAttempt: number;
  result: StepResult;
  // Precomputed gate evaluation. Absent ⇒ no gate, so `result.status` is authoritative.
  gateOutcome?: GateOutcome;
  // The gate's on_failure policy, if any. Drives the restart branch (fail-closed
  // until PR E makes durable restart executable).
  gateOnFailure?: {restartFrom: string; output?: string};
  // PR E adds the restart attempt cap here.
}

// The semantic outcome of a step report, independent of persistence. The restart
// variants are typed now but only produced once durable restart lands (PR E).
export type StepTransitionDecision =
  | {kind: 'complete-step'; stepId: string; attempt: number}
  // The step succeeds and is the last to finish; apply re-derives the job's
  // terminal status from the projection (it may be `failed` if a sibling was
  // cancelled), so the status is not carried on the decision.
  | {kind: 'complete-job'; stepId: string; attempt: number}
  | {
      kind: 'fail-job';
      failedStepId: string;
      attempt: number;
      cancelFromPosition: number;
      // The error to record on the step/attempt (the reported error, or a
      // structured gate error).
      failureError: Record<string, unknown> | null;
    }
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

function succeed(target: Step, attempt: number, steps: Step[]): StepTransitionDecision {
  // Completes the job when every other step is already terminal, otherwise just
  // advances this step.
  const everyOtherTerminal = steps
    .filter((step) => step.id !== target.id)
    .every((step) => isTerminal(step.status));
  return everyOtherTerminal
    ? {kind: 'complete-job', stepId: target.id, attempt}
    : {kind: 'complete-step', stepId: target.id, attempt};
}

function fail(
  target: Step,
  attempt: number,
  failureError: Record<string, unknown> | null,
): StepTransitionDecision {
  return {
    kind: 'fail-job',
    failedStepId: target.id,
    attempt,
    cancelFromPosition: target.position,
    failureError,
  };
}

// A failure that carried restart intent we cannot yet honor. Fail loudly so it is
// never silently degraded to an ordinary failure (PR E turns this into a rewind).
function restartUnsupportedError(restartFrom: string): Record<string, unknown> {
  return {
    kind: 'restart_unsupported',
    message: `gate requested restart_from "${restartFrom}" but durable restart is not enabled`,
    restart_from: restartFrom,
  };
}

// Pure: maps a step report (and its precomputed gate outcome) to a transition
// decision. No DB, no expression engine. PR C handled the gate-less cases; this
// adds terminal gate pass/fail and fails closed for an unsupported restart. PR E
// turns the fail-closed restart branch into an actual rewind.
export function decideStepTransition(input: DecideStepTransitionInput): StepTransitionDecision {
  const {steps, target, reportedAttempt, result, gateOnFailure} = input;
  const gate = input.gateOutcome ?? {kind: 'no-gate'};

  if (gate.kind === 'no-gate') {
    if (result.status === 'succeeded') return succeed(target, reportedAttempt, steps);
    // `on_failure` may be set without a `success_if` predicate (the document
    // schema allows it): a raw command failure then still carries restart intent,
    // so fail closed loudly rather than as a plain failure.
    if (gateOnFailure?.restartFrom) {
      return fail(target, reportedAttempt, restartUnsupportedError(gateOnFailure.restartFrom));
    }
    return fail(target, reportedAttempt, result.error ?? null);
  }

  if (gate.kind === 'passed') {
    // The gate is authoritative over the raw command status.
    return succeed(target, reportedAttempt, steps);
  }

  if (gate.kind === 'uncheckable') {
    // No exit code (signal-kill) or an evaluation error: a plain command failure.
    // Fail closed — never a restart.
    return fail(
      target,
      reportedAttempt,
      result.error ?? {kind: 'gate_uncheckable', message: gate.reason},
    );
  }

  // gate.kind === 'failed'
  if (gateOnFailure?.restartFrom) {
    // Durable restart is not executable until PR E; fail loudly.
    return fail(target, reportedAttempt, restartUnsupportedError(gateOnFailure.restartFrom));
  }
  return fail(target, reportedAttempt, {
    kind: 'gate_failed',
    message: 'gate condition not met',
    source: gate.source,
  });
}
