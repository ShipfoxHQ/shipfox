import type {WorkflowExpression} from '../expression/workflow-expression.js';
import {resolveContextRootHost} from '../workflow-context/workflow-context.js';
import {extractExactContextRoots} from './extract-exact-context-roots.js';

export type ServerEvaluabilityViolation = {
  readonly reason: 'runner-root-in-server-expression';
  readonly source: string;
  readonly runnerRoots: readonly string[];
};

export type ServerEvaluabilityResult =
  | {readonly ok: true}
  | {readonly ok: false; readonly violations: readonly ServerEvaluabilityViolation[]};

export function validateServerEvaluable(expression: WorkflowExpression): ServerEvaluabilityResult {
  const runnerRoots = extractExactContextRoots(expression.source).filter(
    (root) => resolveContextRootHost(root) === 'runner',
  );

  if (runnerRoots.length === 0) return {ok: true};

  return {
    ok: false,
    violations: [
      {
        reason: 'runner-root-in-server-expression',
        source: expression.source,
        runnerRoots,
      },
    ],
  };
}
