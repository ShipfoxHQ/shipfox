import {
  createWorkflowExpression,
  evaluateWorkflowPredicateFailClosed,
  type WorkflowExpression,
} from '@shipfox/expression';
import type {TriggerSubscription} from './entities/subscription.js';

// Narrow the jsonb projection at the read boundary: the parser writes the right shapes,
// but the column is unconstrained and these values reach run inputs.

export function readConfigInputs(
  subscription: TriggerSubscription,
): Record<string, unknown> | undefined {
  const value = subscription.config.with;
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export type TriggerFilterEvaluation =
  | {kind: 'matched'}
  | {kind: 'filtered'}
  | {kind: 'filter-error'; reason: string};

export interface EvaluateTriggerFilterParams {
  subscription: TriggerSubscription;
  source: string;
  event: string;
  payload: unknown;
}

export function evaluateTriggerFilter(
  params: EvaluateTriggerFilterParams,
): TriggerFilterEvaluation {
  const {subscription} = params;
  const value = subscription.config.filter;
  if (value === null || value === undefined) return {kind: 'matched'};
  if (typeof value !== 'string' || value.trim() === '') {
    return {
      kind: 'filter-error',
      reason: 'Trigger subscription filter must be a non-empty string when set',
    };
  }

  let expression: WorkflowExpression;
  try {
    expression = createWorkflowExpression({source: value, check: {mode: 'syntax'}});
  } catch (error) {
    return {kind: 'filter-error', reason: reasonFrom(error)};
  }

  const result = evaluateWorkflowPredicateFailClosed(expression, {
    event: params.payload,
    trigger: {source: params.source, event: params.event},
  });

  if (result.evaluationFailed) {
    return {kind: 'filter-error', reason: 'Trigger filter evaluation failed'};
  }

  return result.value ? {kind: 'matched'} : {kind: 'filtered'};
}

function reasonFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
