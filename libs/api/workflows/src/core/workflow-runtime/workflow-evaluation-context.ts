import type {AvailabilitySite, WorkflowExpressionEvaluationContext} from '@shipfox/expression';

export interface WorkflowEvaluationContext {
  readonly site: AvailabilitySite;
  readonly values: WorkflowExpressionEvaluationContext;
}
