import type {AgentThinking, Harness} from '@shipfox/api-agent-dto';
import type {
  EvaluationTraceEntry,
  EvaluationTraceLimitEntry,
  ResolvedField,
  WorkflowExpression,
} from '@shipfox/expression';
import type {InterpolationUnresolvableField} from '../errors.js';

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';
export type StepAttemptLogOutcome = 'drained' | 'abandoned';

// The statuses a step can hold once it is done. `skipped` is a terminal,
// non-failing status: an execution containing only succeeded/skipped steps
// resolves succeeded. Single source of truth for the dispatch/cancel guards and
// the `TERMINAL_STATUSES` set; both `core` and `db` import from this boundary.
export const TERMINAL_STEP_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
] as const satisfies readonly StepStatus[];

// A step_attempts row exists only once an attempt is dispatched, so it is never
// 'pending'; a skipped step is attempt-less, so an attempt is never 'skipped'.
export type StepAttemptStatus = Exclude<StepStatus, 'pending' | 'skipped'>;

// Why a step was skipped by its `if:` predicate. `condition_rejected` = the
// predicate evaluated to a clean `false`; `condition_errored` = it fell closed
// on a non-boolean/unresolved/eval error. (The implicit-default-gate reason
// `default_gate_rejected` arrives with continue-after-failure.)
export const STEP_STATUS_REASONS = ['condition_rejected', 'condition_errored'] as const;
export type StepStatusReason = (typeof STEP_STATUS_REASONS)[number];

const STEP_STATUS_REASON_SET = new Set<StepStatusReason>(STEP_STATUS_REASONS);

export function toStepStatusReason(value: string | null): StepStatusReason | null {
  if (value === null) return null;
  return STEP_STATUS_REASON_SET.has(value as StepStatusReason) ? (value as StepStatusReason) : null;
}

export interface StepSourceLocation {
  startLine: number;
  endLine: number;
}

/**
 * Trace entry after a resolver-local expression trace is attached to workflow
 * storage.
 *
 * Step config traces are stored on step attempts with the resolved attempt
 * config; job-level traces are stored on the job or job-execution row whose
 * value/status they explain. Keep `field` as the authored field path that
 * produced the trace, not as a step-only enum.
 */
export type PersistedEvaluationTraceEntry =
  | (EvaluationTraceEntry & {
      readonly field: string;
      readonly envKey?: string;
    })
  | EvaluationTraceLimitEntry;

export interface StepConfigEvaluationTraceEntry extends EvaluationTraceEntry {
  readonly field: InterpolationUnresolvableField;
  readonly envKey?: string;
}

export interface StepConfigDispatchPlan {
  run?: ResolvedField;
  env?: Readonly<Record<string, ResolvedField>>;
  agent?: {
    prompt?: ResolvedField;
    model?: ResolvedField;
    provider?: ResolvedField;
    harness?: Harness;
    thinking?: AgentThinking;
  };
  trace?: readonly (StepConfigEvaluationTraceEntry | EvaluationTraceLimitEntry)[];
}

export interface Step {
  id: string;
  jobExecutionId: string;
  key: string | null;
  name: string;
  sourceLocation: StepSourceLocation | null;
  status: StepStatus;
  // Why the step was skipped, when `status === 'skipped'`; null otherwise.
  statusReason: StepStatusReason | null;
  type: string;
  config: Record<string, unknown>;
  configPlan: StepConfigDispatchPlan | null;
  // The materialized `if:` predicate, evaluated server-side at each dispatch.
  // A false/errored result skips the step before any attempt is created.
  condition: WorkflowExpression | null;
  authoredConfig: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  position: number;
  version: number;
  // Execution-attempt identity for the current projection: which attempt the
  // status/output/error above reflect. Distinct from `version` (the optimistic
  // row counter). Starts at 1 and is bumped when a step is rewound.
  currentAttempt: number;
  createdAt: Date;
  updatedAt: Date;
}

// Append-only execution history: one row per dispatched attempt of a step. The
// current projection lives on `Step`; this is the audit trail and the
// idempotency anchor (unique on (stepId, attempt)).
export interface StepAttempt {
  id: string;
  stepId: string;
  attempt: number;
  executionOrder: number;
  status: StepAttemptStatus;
  config: Record<string, unknown> | null;
  evaluationTrace: readonly PersistedEvaluationTraceEntry[] | null;
  output: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  exitCode: number | null;
  gateResult: Record<string, unknown> | null;
  restartFeedback: string | null;
  logOutcome: StepAttemptLogOutcome | null;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
}
