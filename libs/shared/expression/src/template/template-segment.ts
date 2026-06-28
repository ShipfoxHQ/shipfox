import type {WorkflowExpression} from '../expression/workflow-expression.js';

export interface WorkflowTemplateLiteralSegment {
  readonly kind: 'literal';
  readonly text: string;
}

export interface WorkflowTemplateExprSegment {
  readonly kind: 'expr';
  readonly expression: WorkflowExpression;
  readonly roots: readonly string[];
}

export type WorkflowTemplateSegment = WorkflowTemplateLiteralSegment | WorkflowTemplateExprSegment;
