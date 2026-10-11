import {
  capTraceEntries,
  evaluatePlannedPredicateAtSite,
  predicateTraceEntry,
  type ResolvedField,
  type WorkflowExpression,
} from '@shipfox/expression';
import {WORKFLOW_GATE_MAX_ATTEMPTS_MAX} from '@shipfox/workflow-document';
import type {PersistedEvaluationTraceEntry, StepType} from '../entities/step.js';
import {assembleGateContext} from '../step-config/assemble-run-context.js';
import {completeStepField} from '../step-config/fields.js';
import type {GateOutcome, StepReport} from './decide-step-transition.js';

// The exact `uncheckable` reason recorded when the gate's CEL expression itself
// throws (as opposed to a missing exit code). The DTO mapper keys on this string to
// surface a distinct `evaluation_error` gate result, so the producer and the mapper
// must share this constant rather than duplicating the literal.
export const GATE_EVALUATION_ERROR_REASON = 'gate expression evaluation failed';

// The gate as parsed from a step's materialized `config.gate` (snake_case JSON).
export interface StepGate {
  success?: WorkflowExpression;
  // A single `on_failure` object reads as a one-rule list.
  onFailure?: readonly StepGateRestartRule[];
}

export interface StepGateRestartRule {
  if?: WorkflowExpression;
  restartFrom: string;
  feedback?: string;
  feedbackTemplate?: ResolvedField;
  maxAttempts?: number;
}

// Read the gate persisted on a step's config by the materializer. Returns
// undefined when the step has no gate of interest.
export function readStepGate(config: Record<string, unknown>): StepGate | undefined {
  const gate = config.gate;
  if (!gate || typeof gate !== 'object') return undefined;
  const raw = gate as Record<string, unknown>;

  const success = readGateExpression(raw.success);
  const onFailure = readGateOnFailure(raw.on_failure);

  if (!success && !onFailure) return undefined;
  return {
    ...(success ? {success} : {}),
    ...(onFailure ? {onFailure} : {}),
  };
}

function readGateExpression(value: unknown): WorkflowExpression | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (typeof (value as Record<string, unknown>).source !== 'string') return undefined;
  return value as WorkflowExpression;
}

// One invalid rule drops the whole policy, as an invalid single rule always has: a
// partially readable list could restart from a rule the author meant to guard.
function readGateOnFailure(value: unknown): StepGate['onFailure'] {
  const rawRules = Array.isArray(value) ? value : [value];
  if (rawRules.length === 0) return undefined;

  const rules: StepGateRestartRule[] = [];
  for (const rawRule of rawRules) {
    const rule = readGateRestartRule(rawRule);
    if (rule === undefined) return undefined;
    rules.push(rule);
  }
  return rules;
}

function readGateRestartRule(value: unknown): StepGateRestartRule | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.restart_from !== 'string') return undefined;

  const maxAttempts = readGateMaxAttempts(raw.max_attempts);
  if (maxAttempts === 'invalid') return undefined;

  const condition = readGateExpression(raw.if);
  if (raw.if !== undefined && condition === undefined) return undefined;

  const feedbackTemplate = readGateFeedbackTemplate(raw.feedback_template);
  return {
    ...(condition === undefined ? {} : {if: condition}),
    restartFrom: raw.restart_from,
    ...(typeof raw.feedback === 'string' ? {feedback: raw.feedback} : {}),
    ...(feedbackTemplate === undefined ? {} : {feedbackTemplate}),
    ...(maxAttempts === undefined ? {} : {maxAttempts}),
  };
}

function readGateMaxAttempts(value: unknown): number | 'invalid' | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > WORKFLOW_GATE_MAX_ATTEMPTS_MAX
  ) {
    return 'invalid';
  }
  return value;
}

function readGateFeedbackTemplate(value: unknown): ResolvedField | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const segments = (value as Record<string, unknown>).segments;
  if (!Array.isArray(segments)) return undefined;
  if (!segments.every((segment) => typeof segment === 'object' && segment !== null))
    return undefined;
  return value as ResolvedField;
}

/**
 * Gate evaluation fails closed: a missing exit code on a runner step or a CEL
 * evaluation error is `uncheckable` (a plain command failure), never a gate
 * failure that can restart. Tool steps intentionally have no exit code, so
 * their gates evaluate against the step status and outputs instead. Tool-step
 * failures remain non-restartable because provider calls may have side effects.
 *
 * Callers hold step-row locks while this runs. Keep the CEL context bounded
 * unless evaluation gets a budget outside the lock. The materializer only
 * persists CEL expressions, and this evaluator only needs the validated source.
 */
export function evaluateGate(
  gate: StepGate | undefined,
  result: StepReport,
  vars?: Record<string, string> | undefined,
  options?: {readonly stepType?: StepType},
): GateOutcome {
  if (!gate?.success) return {kind: 'no-gate'};
  const source = gate.success.source;

  if (options?.stepType !== 'tool' && (result.exitCode === null || result.exitCode === undefined)) {
    return {kind: 'uncheckable', reason: 'step produced no exit code', source};
  }

  const context = assembleGateContext({
    status: result.status,
    exitCode: result.exitCode ?? null,
    output: result.output,
    ...(options?.stepType === 'tool' ? {error: toolStepGateError(result)} : {}),
    vars,
  });
  const outcome = evaluatePlannedPredicateAtSite({
    expression: gate.success,
    field: 'step.success',
    site: context.site,
    context: context.values,
  });
  const trace = capTraceEntries([
    {
      ...predicateTraceEntry({
        expression: source,
        route: outcome.route,
        site: context.site,
        value: outcome.value,
        degraded: outcome.evaluationFailed,
      }),
      field: 'step.success',
    },
  ]);
  if (outcome.evaluationFailed) {
    return {kind: 'uncheckable', reason: GATE_EVALUATION_ERROR_REASON, source, trace};
  }
  return outcome.value ? {kind: 'passed', source, trace} : {kind: 'failed', source, trace};
}

// The recorded tool error as the gate reads it, or null when the call did not fail.
function toolStepGateError(result: StepReport): {code: string; status?: number} | null {
  if (result.status !== 'failed') return null;
  const {code, status} = result.error ?? {};
  return {
    code: typeof code === 'string' ? code : '',
    ...(typeof status === 'number' && Number.isInteger(status) ? {status} : {}),
  };
}

// The restart decision for a failed step: which `on_failure` rule applies, if any.
// Positions are 1-based, as the author reads them in the list.
export type RestartRuleSelection =
  | {
      kind: 'selected';
      position: number;
      ruleCount: number;
      rule: StepGateRestartRule;
      trace: readonly PersistedEvaluationTraceEntry[];
    }
  | {kind: 'none-applied'; ruleCount: number; trace: readonly PersistedEvaluationTraceEntry[]}
  | {
      kind: 'evaluation-failed';
      position: number;
      ruleCount: number;
      source: string;
      error?: {message: string; path?: string};
      trace: readonly PersistedEvaluationTraceEntry[];
    };

/**
 * Walks the `on_failure` rules in order against the same context `success` reads.
 * The first rule with no `if`, or whose `if` is true, is selected. A rule whose `if`
 * cannot be evaluated stops the walk, so a later rule never restarts a failure the
 * author could not classify. Returns undefined when nothing can restart: no rules,
 * or a tool step, because provider calls may have side effects.
 *
 * Call only for a failed step. Like `evaluateGate`, this runs under step-row locks.
 */
export function selectRestartRule(params: {
  readonly gate: StepGate | undefined;
  readonly result: StepReport;
  readonly vars?: Record<string, string> | undefined;
  readonly stepType?: StepType;
}): RestartRuleSelection | undefined {
  const rules = params.gate?.onFailure;
  if (rules === undefined || params.stepType === 'tool') return undefined;

  const context = assembleGateContext({
    status: params.result.status,
    exitCode: params.result.exitCode ?? null,
    output: params.result.output,
    vars: params.vars,
  });
  const ruleCount = rules.length;
  const entries: PersistedEvaluationTraceEntry[] = [];
  for (const [index, rule] of rules.entries()) {
    const position = index + 1;
    if (rule.if === undefined) {
      return {kind: 'selected', position, ruleCount, rule, trace: capTraceEntries(entries)};
    }

    const outcome = evaluatePlannedPredicateAtSite({
      expression: rule.if,
      field: 'step.success',
      site: context.site,
      context: context.values,
    });
    entries.push({
      ...predicateTraceEntry({
        expression: rule.if.source,
        route: outcome.route,
        site: context.site,
        value: outcome.value,
        degraded: outcome.evaluationFailed,
        ...(outcome.error === undefined ? {} : {error: outcome.error}),
      }),
      field: 'step.success',
    });
    if (outcome.evaluationFailed) {
      return {
        kind: 'evaluation-failed',
        position,
        ruleCount,
        source: rule.if.source,
        ...(outcome.error === undefined ? {} : {error: outcome.error}),
        trace: capTraceEntries(entries),
      };
    }
    if (outcome.value) {
      return {kind: 'selected', position, ruleCount, rule, trace: capTraceEntries(entries)};
    }
  }
  return {kind: 'none-applied', ruleCount, trace: capTraceEntries(entries)};
}

export function evaluateGateFeedback(params: {
  readonly rule: StepGateRestartRule;
  readonly result: StepReport;
  readonly definitionId: string;
  readonly vars?: Record<string, string> | undefined;
}): string {
  const feedbackTemplate = params.rule.feedbackTemplate;
  if (feedbackTemplate === undefined) {
    return params.rule.feedback ?? 'gate condition not met';
  }

  const context = assembleGateContext({
    status: params.result.status,
    exitCode: params.result.exitCode ?? null,
    output: params.result.output,
    vars: params.vars,
  });
  return completeStepField({
    field: 'step.feedback',
    errorField: 'step.feedback',
    template: feedbackTemplate,
    context,
    definitionId: params.definitionId,
  });
}

// Build the audit payload recorded on the step attempt for a gate evaluation.
// Includes the evaluated `exit_code` so the gate decision is reconstructable from
// the attempt row alone, independent of the column shape. The restart decision is
// recorded under `restart`, also when the gate has no `success`.
export function gateResultPayload(
  outcome: GateOutcome,
  exitCode: number | null | undefined,
  restart?: RestartRuleSelection,
): Record<string, unknown> | null {
  const payload = gateOutcomePayload(outcome, exitCode);
  if (restart === undefined) return payload;
  return {
    ...(payload ?? {exit_code: exitCode ?? null}),
    restart: restartDecisionPayload(restart),
  };
}

function restartDecisionPayload(selection: RestartRuleSelection): Record<string, unknown> {
  const trace = selection.trace.length === 0 ? {} : {trace: selection.trace};
  switch (selection.kind) {
    case 'selected':
      return {
        kind: 'restart',
        rule: selection.position,
        rule_count: selection.ruleCount,
        restart_from: selection.rule.restartFrom,
        ...trace,
      };
    case 'none-applied':
      return {kind: 'none_applied', rule_count: selection.ruleCount, ...trace};
    case 'evaluation-failed':
      return {
        kind: 'evaluation_failed',
        rule: selection.position,
        rule_count: selection.ruleCount,
        source: selection.source,
        ...(selection.error === undefined ? {} : {error: selection.error}),
        ...trace,
      };
  }
}

function gateOutcomePayload(
  outcome: GateOutcome,
  exitCode: number | null | undefined,
): Record<string, unknown> | null {
  const exit_code = exitCode ?? null;
  switch (outcome.kind) {
    case 'no-gate':
      return null;
    case 'passed':
      return {
        passed: true,
        source: outcome.source,
        exit_code,
        ...(outcome.trace === undefined ? {} : {trace: outcome.trace}),
      };
    case 'failed':
      return {
        passed: false,
        source: outcome.source,
        exit_code,
        ...(outcome.trace === undefined ? {} : {trace: outcome.trace}),
      };
    case 'uncheckable':
      return {
        passed: false,
        uncheckable: true,
        reason: outcome.reason,
        source: outcome.source,
        exit_code,
        ...(outcome.trace === undefined ? {} : {trace: outcome.trace}),
      };
  }
}
