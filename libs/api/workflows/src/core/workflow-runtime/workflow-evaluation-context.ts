import type {WorkflowContextPhase, WorkflowExpressionEvaluationContext} from '@shipfox/expression';

export interface WorkflowEvaluationContext {
  readonly phase: WorkflowContextPhase;
  readonly values: WorkflowExpressionEvaluationContext;
}
