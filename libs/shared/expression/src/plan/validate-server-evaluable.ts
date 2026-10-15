import type {WorkflowExpression} from '../expression/workflow-expression.js';
import {resolveContextRootHost} from '../workflow-context/workflow-context.js';
import {extractExactContextRoots} from './extract-exact-context-roots.js';
import {analyzeRunnerCalls, type RunnerCallFunction} from './runner-call.js';

export type ServerEvaluabilityViolation =
  | {
      readonly reason: 'runner-root-in-server-expression';
      readonly source: string;
      readonly runnerRoots: readonly string[];
    }
  | {
      readonly reason: 'runner-call-in-server-expression';
      readonly source: string;
      readonly function: RunnerCallFunction;
    };

export type ServerEvaluabilityResult =
  | {readonly ok: true}
  | {readonly ok: false; readonly violations: readonly ServerEvaluabilityViolation[]};

export function validateServerEvaluable(expression: WorkflowExpression): ServerEvaluabilityResult {
  const violations: ServerEvaluabilityViolation[] = [];
  const runnerRoots = extractExactContextRoots(expression.source).filter(
    (root) => resolveContextRootHost(root) === 'runner',
  );
  if (runnerRoots.length > 0) {
    violations.push({
      reason: 'runner-root-in-server-expression',
      source: expression.source,
      runnerRoots,
    });
  }

  const runnerCall = analyzeRunnerCalls(expression.source);
  if (runnerCall.kind !== 'none') {
    violations.push({
      reason: 'runner-call-in-server-expression',
      source: expression.source,
      function: runnerCall.kind === 'bare' ? runnerCall.call.function : runnerCall.function,
    });
  }

  return violations.length === 0 ? {ok: true} : {ok: false, violations};
}
