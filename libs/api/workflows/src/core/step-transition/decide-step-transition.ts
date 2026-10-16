import type {PersistedEvaluationTraceEntry, Step, StepStatus} from '../entities/step.js';

const TERMINAL_STATUSES: ReadonlySet<StepStatus> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);

export function isTerminal(status: StepStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * False for a failure that `continue_on_error` covered and for a post whose action declared
 * `post_failure: warn`. The step still fails, but `run_after` and the job result ignore it.
 */
export function stepAffectsConclusion(
  step: Pick<Step, 'type' | 'config' | 'statusReason'>,
): boolean {
  if (step.statusReason === 'failure_ignored') return false;
  if (step.type !== 'post') return true;
  const post = step.config.post;
  if (post === null || typeof post !== 'object') return true;
  return (post as {failure?: unknown}).failure === 'fail';
}

/**
 * Whether a failure of this step may restart the job. A tool step restarts only when its call reads,
 * because a write the provider already applied would apply again. A tool step with no recorded
 * sensitivity counts as a write.
 */
export function stepCanRestart(step: Pick<Step, 'type' | 'config'>): boolean {
  if (step.type !== 'tool') return true;
  const tool = step.config.tool;
  if (tool === null || typeof tool !== 'object') return false;
  return (tool as {sensitivity?: unknown}).sensitivity === 'read';
}

/** Whether any step that counts toward the job result has failed. */
export function hasFailedStep(steps: readonly Step[]): boolean {
  return steps.some((step) => step.status === 'failed' && stepAffectsConclusion(step));
}

export function deriveCompletion(steps: Step[]): 'succeeded' | 'failed' {
  return hasFailedStep(steps) ? 'failed' : 'succeeded';
}

// The report the runner sent for the step being decided.
export interface StepReport {
  status: 'succeeded' | 'failed';
  exitCode?: number | null;
  error?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  response?: string | null;
  logPath?: string | null;
}

// Precomputed gate evaluation (the CEL engine runs in evaluate-gate.ts, never
// here). `passed`/`failed` are clean evaluations; `uncheckable` means the gate
// could not be evaluated (a required exit code is missing, or an evaluation
// error) and is treated as a plain command failure, which never restarts. Nor
// does the failure of a tool step whose call writes (see `stepCanRestart`).
export type GateOutcome =
  | {kind: 'no-gate'}
  | {kind: 'passed'; source: string; trace?: readonly PersistedEvaluationTraceEntry[]}
  | {kind: 'failed'; source: string; trace?: readonly PersistedEvaluationTraceEntry[]}
  | {
      kind: 'uncheckable';
      reason: string;
      source: string;
      trace?: readonly PersistedEvaluationTraceEntry[];
    };

/** The restart feedback when the author wrote none. */
export function defaultRestartFeedback(gate: GateOutcome | undefined): string {
  return gate?.kind === 'failed'
    ? `The check \`${gate.source}\` returned false.`
    : 'The step failed.';
}

export interface DecideStepTransitionInput {
  // Full job projection, position-ordered (as returned by getStepsByJobIdForUpdate).
  steps: Step[];
  // The reporting step, already confirmed running at `reportedAttempt`.
  target: Step;
  reportedAttempt: number;
  result: StepReport;
  // Precomputed gate evaluation. Absent ⇒ no gate, so `result.status` is authoritative.
  gateOutcome?: GateOutcome;
  // The gate's on_failure policy, if any. Drives the restart branch.
  gateOnFailure?: {restartFrom: string; feedback?: string};
  restartFeedback?: string;
  // Max total attempts for the gating step before restart is exhausted; defaults
  // to DEFAULT_RESTART_ATTEMPT_CAP.
  maxAttempts?: number;
  // The gating step's own execution count (number of its attempts), used for the
  // cap. Defaults to `reportedAttempt`: correct for a single-gate job, where the
  // two are equal; the service passes the real count so a downstream gate in a
  // multi-gate job isn't penalized for upstream-induced rewinds.
  gatingAttemptCount?: number;
}

// Per-step restart cap: the gating step may run at most this many attempts before
// a further restart is refused. Bounds runaway restart loops.
export const DEFAULT_RESTART_ATTEMPT_CAP = 3;

// The semantic outcome of a step report, independent of persistence.
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
      // The error to record on the step/attempt (the reported error, or a
      // structured gate error).
      failureError: Record<string, unknown> | null;
      // Set when the step's `continue_on_error` covers its own failure.
      failureIgnored?: true;
    }
  | {
      kind: 'restart-job-from-step';
      failedStepId: string;
      restartFromStepId: string;
      restartFromPosition: number;
      attempt: number;
      feedback: string;
      // Recorded on the failed attempt before the rewind clears the projection.
      failureError: Record<string, unknown> | null;
    }
  | {
      kind: 'fail-job-restart-exhausted';
      failedStepId: string;
      attempt: number;
      maxAttempts: number;
      failureError: Record<string, unknown> | null;
      failureIgnored?: true;
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
    failureError,
  };
}

// `continue_on_error` covers the step's own final failure, not a workflow error found while
// deciding it, such as an unresolved `restart_from`.
function ignoredFailure(target: Step): {failureIgnored?: true} {
  return target.continueOnError ? {failureIgnored: true} : {};
}

// Pure: maps a step report (and its precomputed gate outcome) to a transition
// decision. No DB, no expression engine. A passing gate succeeds; a checkable
// failure with a resolvable `restart_from` rewinds (until the per-step attempt cap
// is hit); everything else fails the job. An `uncheckable` failure (a required exit
// code is missing or evaluation errors) and the failure of a tool step that writes
// are always plain failures, never restarts.
export function decideStepTransition(input: DecideStepTransitionInput): StepTransitionDecision {
  const {steps, target, reportedAttempt, result, gateOnFailure} = input;
  const gate = input.gateOutcome ?? {kind: 'no-gate'};
  const maxAttempts = input.maxAttempts ?? DEFAULT_RESTART_ATTEMPT_CAP;

  // 1. Did the step pass? The gate (when present and checkable) is authoritative
  //    over the raw command status.
  if (stepReportPassed(gate, result)) {
    return succeed(target, reportedAttempt, steps);
  }

  // 2. It failed. Classify the failure error and whether it is restartable.
  const restartAllowed = stepCanRestart(target) && gate.kind !== 'uncheckable';
  const failureError = stepFailureError(gate, result, gateOnFailure?.restartFrom);

  // 3. Restart when a policy is configured and the failure is checkable.
  if (gateOnFailure?.restartFrom && restartAllowed) {
    return restartStepTransition(
      input,
      gateOnFailure,
      failureError,
      maxAttempts,
      gate.kind !== 'no-gate',
    );
  }

  // 4. No restart → plain fail-and-cancel.
  return {...fail(target, reportedAttempt, failureError), ...ignoredFailure(target)};
}

function stepReportPassed(gate: GateOutcome, result: StepReport): boolean {
  if (gate.kind === 'no-gate') return result.status === 'succeeded';
  return gate.kind === 'passed';
}

function stepFailureError(
  gate: GateOutcome,
  result: StepReport,
  restartFrom: string | undefined,
): Record<string, unknown> | null {
  const restartFields = restartFrom === undefined ? {} : {restartFrom};

  if (gate.kind === 'failed') {
    return {
      kind: 'gate_failed',
      reason: 'gate_failed',
      message: 'gate condition not met',
      retryable: false,
      source: gate.source,
      ...restartFields,
    };
  }
  if (gate.kind === 'uncheckable') {
    const errorFields = {...(result.error ?? {})};
    delete errorFields.agentConfigIssue;
    delete errorFields.agent_config_issue;
    return {
      ...errorFields,
      kind: 'gate_uncheckable',
      reason: 'gate_uncheckable',
      message: errorMessage(result.error) ?? gate.reason,
      retryable: false,
      source: gate.source,
      ...restartFields,
    };
  }
  return result.error ?? null;
}

function errorMessage(error: Record<string, unknown> | null | undefined): string | undefined {
  const message = error?.message;
  return typeof message === 'string' && message.length > 0 ? message : undefined;
}

function restartStepTransition(
  input: DecideStepTransitionInput,
  gateOnFailure: NonNullable<DecideStepTransitionInput['gateOnFailure']>,
  failureError: Record<string, unknown> | null,
  maxAttempts: number,
  hasSuccessGate: boolean,
): StepTransitionDecision {
  const {steps, target, reportedAttempt} = input;
  const terminalFailureFields = {...(failureError ?? {})};
  delete terminalFailureFields.agentConfigIssue;
  delete terminalFailureFields.agent_config_issue;
  // A restart target is an earlier step of the same scope: the job, or the composite that holds
  // the gating step.
  const restartStep = steps.find(
    (step) =>
      step.type !== 'setup' &&
      step.parentStepId === target.parentStepId &&
      step.position < target.position &&
      step.key === gateOnFailure.restartFrom,
  );
  if (!restartStep) {
    return fail(target, reportedAttempt, {
      ...terminalFailureFields,
      kind: 'restart_unresolved',
      reason: 'restart_unresolved',
      message: `could not resolve restart_from "${gateOnFailure.restartFrom}"`,
      retryable: false,
      restartFrom: gateOnFailure.restartFrom,
    });
  }
  const gatingAttemptCount = input.gatingAttemptCount ?? reportedAttempt;
  if (gatingAttemptCount >= maxAttempts) {
    const attemptLabel = gatingAttemptCount === 1 ? 'attempt' : 'attempts';
    const exhaustionMessage = hasSuccessGate
      ? `The gate did not pass after ${gatingAttemptCount} ${attemptLabel}.`
      : `The step failed after ${gatingAttemptCount} ${attemptLabel}.`;
    return {
      kind: 'fail-job-restart-exhausted',
      failedStepId: target.id,
      attempt: reportedAttempt,
      maxAttempts,
      ...ignoredFailure(target),
      failureError: {
        ...terminalFailureFields,
        kind: 'restart_exhausted',
        reason: 'restart_exhausted',
        message: exhaustionMessage,
        retryable: false,
        attemptCount: gatingAttemptCount,
        maxAttempts,
        restartFrom: gateOnFailure.restartFrom,
      },
    };
  }
  return {
    kind: 'restart-job-from-step',
    failedStepId: target.id,
    restartFromStepId: restartStep.id,
    restartFromPosition: restartStep.position,
    attempt: reportedAttempt,
    feedback:
      input.restartFeedback ?? gateOnFailure.feedback ?? defaultRestartFeedback(input.gateOutcome),
    failureError,
  };
}
