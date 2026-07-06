import type {WorkflowExpression} from '../expression/workflow-expression.js';
import {
  availabilitySites,
  type FillTarget,
  resolveContextRootAvailability,
  resolveContextRootHost,
  runnerFillTarget,
} from '../workflow-context/workflow-context.js';
import {analyzeContextRootKeyAccess} from './context-key-access.js';
import {extractExactContextRoots} from './extract-exact-context-roots.js';

export interface RoutedExpression {
  readonly roots: readonly string[];
  readonly runnerRoots: readonly string[];
  readonly fillTarget: FillTarget;
}

export function routeExpression(expression: WorkflowExpression): RoutedExpression {
  const roots = extractExactContextRoots(expression.source);
  const knownRoots = roots.filter((root) => resolveContextRootHost(root) !== undefined);
  const runnerRoots = knownRoots.filter((root) => resolveContextRootHost(root) === 'runner');

  if (runnerRoots.length > 0) {
    return {roots, runnerRoots, fillTarget: runnerFillTarget};
  }

  return {
    roots,
    runnerRoots,
    fillTarget: expressionMinimumFillTarget(expression, maxAvailabilitySite(knownRoots)),
  };
}

function expressionMinimumFillTarget(
  expression: WorkflowExpression,
  fillTarget: FillTarget,
): FillTarget {
  if (fillTarget === runnerFillTarget) return fillTarget;
  if (!referencesExecutionFailed(expression)) return fillTarget;
  return laterFillTarget(fillTarget, 'step-dispatch');
}

function referencesExecutionFailed(expression: WorkflowExpression): boolean {
  const access = analyzeContextRootKeyAccess(expression, ['execution']);
  return access.references.some((reference) => reference.key === 'failed');
}

function laterFillTarget(left: FillTarget, right: FillTarget): FillTarget {
  if (left === runnerFillTarget || right === runnerFillTarget) return runnerFillTarget;
  return availabilitySites.indexOf(left) >= availabilitySites.indexOf(right) ? left : right;
}

function maxAvailabilitySite(roots: readonly string[]): FillTarget {
  let maxIndex = 0;
  for (const root of roots) {
    const availability = resolveContextRootAvailability(root);
    if (availability === undefined) continue;
    maxIndex = Math.max(maxIndex, availabilitySites.indexOf(availability));
  }

  return availabilitySites[maxIndex] ?? availabilitySites[0];
}
