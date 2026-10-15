import type {WorkflowExpression} from '../expression/workflow-expression.js';
import type {FillTarget} from '../workflow-context/workflow-context.js';
import type {RunnerCall} from './runner-call.js';

export interface ResolvedFieldLiteralSegment {
  readonly kind: 'literal';
  readonly value: string;
}

export interface ResolvedFieldDeferredSegment {
  readonly kind: 'deferred';
  readonly expression: WorkflowExpression;
  readonly roots: readonly string[];
  readonly fillTarget: FillTarget;
  /** Set when the whole segment is a call the runner computes, such as `hashFiles()`. */
  readonly runnerCall?: RunnerCall;
}

export type ResolvedFieldSegment = ResolvedFieldLiteralSegment | ResolvedFieldDeferredSegment;

export interface ResolvedField {
  readonly segments: readonly ResolvedFieldSegment[];
}
