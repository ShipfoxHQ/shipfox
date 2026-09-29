import type {WorkflowExpression} from '../expression/workflow-expression.js';
import {analyzeContextPathAccess, type ContextPathSegment} from './extract-context-paths.js';

/**
 * Whether the expression reads a step attempt's `log_path`: `steps.<key>`,
 * `steps.<key>.attempts[i]`, or the same shapes under `step.restart.from`.
 * A step output that happens to be named `log_path` is not a match.
 */
export function referencesStepLogPath(expression: WorkflowExpression | string): boolean {
  const {references} = analyzeContextPathAccess(expression, ['steps', 'step']);
  return references.some(({root, segments}) => {
    if (root === 'steps') return isEntityLogPath(segments.slice(1));
    if (segments[0] !== 'restart' || segments[1] !== 'from') return false;
    return isEntityLogPath(segments.slice(2));
  });
}

// `rest` is what follows the step entity: `steps.<key>` or `step.restart.from`.
function isEntityLogPath(rest: readonly ContextPathSegment[]): boolean {
  if (rest[0] === 'log_path') return true;
  return rest[0] === 'attempts' && rest[2] === 'log_path';
}
