export type WorkflowExpression =
  | WorkflowExpressionRef
  | WorkflowExpressionString
  | WorkflowExpressionNumber
  | WorkflowExpressionBoolean
  | WorkflowExpressionUnary
  | WorkflowExpressionBinary;

export interface WorkflowExpressionRef {
  kind: 'ref';
  path: readonly [WorkflowExpressionRoot, ...string[]];
}

export interface WorkflowExpressionString {
  kind: 'string';
  value: string;
}

export interface WorkflowExpressionNumber {
  kind: 'number';
  value: number;
}

export interface WorkflowExpressionBoolean {
  kind: 'boolean';
  value: boolean;
}

export interface WorkflowExpressionUnary {
  kind: 'unary';
  op: WorkflowExpressionUnaryOperator;
  argument: WorkflowExpression;
}

export interface WorkflowExpressionBinary {
  kind: 'binary';
  op: WorkflowExpressionBinaryOperator;
  left: WorkflowExpression;
  right: WorkflowExpression;
}

export type WorkflowExpressionRoot = 'event';
export type WorkflowExpressionUnaryOperator = '!';
export type WorkflowExpressionBinaryOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';

export type WorkflowExpressionDiagnosticCode =
  | 'WFE001'
  | 'WFE002'
  | 'WFE003'
  | 'WFE004'
  | 'WFE005'
  | 'WFE006'
  | 'WFE007';

export type WorkflowExpressionDiagnosticSeverity = 'error';

export interface WorkflowExpressionDiagnostic {
  code: WorkflowExpressionDiagnosticCode;
  severity: WorkflowExpressionDiagnosticSeverity;
  message: string;
  position: number;
  details?: Readonly<Record<string, unknown>>;
}

export type ParseWorkflowExpressionResult =
  | {
      valid: true;
      source: string;
      expression: WorkflowExpression;
      diagnostics: readonly [];
    }
  | {
      valid: false;
      source: string;
      diagnostics: readonly WorkflowExpressionDiagnostic[];
    };

export type WorkflowExpressionValue = string | number | boolean | undefined;

export interface WorkflowExpressionEvaluationContext {
  event: Readonly<Record<string, unknown>>;
}
