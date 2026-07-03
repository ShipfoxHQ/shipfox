import type {WorkflowExpression} from '../expression/workflow-expression.js';
import type {FillTarget} from '../workflow-context/workflow-context.js';

export interface ResolvedFieldLiteralSegment {
  readonly kind: 'literal';
  readonly value: string;
}

export interface ResolvedFieldDeferredSegment {
  readonly kind: 'deferred';
  readonly expression: WorkflowExpression;
  readonly roots: readonly string[];
  readonly fillTarget: FillTarget;
}

export type ResolvedFieldSegment = ResolvedFieldLiteralSegment | ResolvedFieldDeferredSegment;

export interface ResolvedField {
  readonly segments: readonly ResolvedFieldSegment[];
}
