export type ValidCelExpression = string & {readonly __validCelExpression: unique symbol};

export interface WorkflowExpression {
  language: 'cel';
  source: ValidCelExpression;
}

export type ExpressionScalarType = 'string' | 'int' | 'double' | 'bool' | 'null' | 'timestamp';

export type ExpressionType =
  | ExpressionScalarType
  | {
      kind: 'object';
      fields: Readonly<Record<string, ExpressionType>>;
    }
  | {
      kind: 'list';
      element: ExpressionType;
    };

export type ExpressionTypeEnvironment = Readonly<Record<string, ExpressionType>>;

export interface CreateWorkflowExpressionParams {
  source: string;
  typeEnvironment?: ExpressionTypeEnvironment;
}
