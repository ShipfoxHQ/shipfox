import {
  evaluateWorkflowPredicate,
  type WorkflowExpression,
  WorkflowExpressionEvaluationError,
} from '@shipfox/expression';
import type {GateOutcome, StepResult} from './decide-step-transition.js';

// The gate as parsed from a step's materialized `config.gate` (snake_case JSON).
export interface StepGate {
  successIf?: WorkflowExpression;
  onFailure?: {restartFrom: string; output?: string};
}

// Read the gate persisted on a step's config by the materializer. Returns
// undefined when the step has no gate of interest.
export function readStepGate(config: Record<string, unknown>): StepGate | undefined {
  const gate = config.gate;
  if (!gate || typeof gate !== 'object') return undefined;
  const raw = gate as Record<string, unknown>;

  const successIfRaw = raw.success_if as Record<string, unknown> | undefined;
  const successIf =
    successIfRaw && typeof successIfRaw.source === 'string'
      ? // The model validated this expression before materialization; the stored
        // JSON is structurally a WorkflowExpression.
        (successIfRaw as unknown as WorkflowExpression)
      : undefined;

  const onFailureRaw = raw.on_failure as Record<string, unknown> | undefined;
  const onFailure =
    onFailureRaw && typeof onFailureRaw.restart_from === 'string'
      ? {
          restartFrom: onFailureRaw.restart_from,
          ...(typeof onFailureRaw.output === 'string' ? {output: onFailureRaw.output} : {}),
        }
      : undefined;

  if (!successIf && !onFailure) return undefined;
  return {
    ...(successIf ? {successIf} : {}),
    ...(onFailure ? {onFailure} : {}),
  };
}

// Evaluate a step's gate against the run-step result. This is the ONLY place that
// runs the CEL engine. It fails closed: a missing exit code or an evaluation
// error is `uncheckable` (a plain command failure), never a gate-failure that
// could trigger a restart.
//
// NOTE: callers run this inside the FOR UPDATE transaction, so the eval holds the
// job's step-row locks. The context is a single scalar (`exit_code`), so this is
// cheap — but do not widen the context (or add CEL call sites) inside the lock
// without an eval budget. `language` is assumed CEL (the only language the
// materializer writes); the evaluator reads only `.source`.
export function evaluateGate(gate: StepGate | undefined, result: StepResult): GateOutcome {
  if (!gate?.successIf) return {kind: 'no-gate'};
  const source = gate.successIf.source;

  if (result.exitCode === null || result.exitCode === undefined) {
    return {kind: 'uncheckable', reason: 'step produced no exit code'};
  }

  try {
    const passed = evaluateWorkflowPredicate(gate.successIf, {exit_code: result.exitCode});
    return passed ? {kind: 'passed', source} : {kind: 'failed', source};
  } catch (error) {
    if (error instanceof WorkflowExpressionEvaluationError) {
      return {kind: 'uncheckable', reason: 'gate expression evaluation failed'};
    }
    throw error;
  }
}

// Build the audit payload recorded on the step attempt for a gate evaluation.
// Includes the evaluated `exit_code` so the gate decision is reconstructable from
// the attempt row alone, independent of the column shape.
export function gateResultPayload(
  outcome: GateOutcome,
  exitCode: number | null | undefined,
): Record<string, unknown> | null {
  const exit_code = exitCode ?? null;
  switch (outcome.kind) {
    case 'no-gate':
      return null;
    case 'passed':
      return {passed: true, source: outcome.source, exit_code};
    case 'failed':
      return {passed: false, source: outcome.source, exit_code};
    case 'uncheckable':
      return {passed: false, uncheckable: true, reason: outcome.reason, exit_code};
  }
}
