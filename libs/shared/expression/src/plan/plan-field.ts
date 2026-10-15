import {parseAnchoredPattern} from '@shipfox/workflow-document/anchored-path';
import type {WorkflowTemplateSegment} from '../template/template-segment.js';
import {
  type AvailabilitySite,
  availabilitySites,
  type FillTarget,
  getWorkflowInterpolationFieldFailurePolicy,
  getWorkflowInterpolationFieldMinimumFillTarget,
  type WorkflowInterpolationFailurePolicy,
  type WorkflowInterpolationField,
  workflowInterpolationFieldAcceptsRunnerCalls,
} from '../workflow-context/workflow-context.js';
import {isBareContextReference} from './bare-reference.js';
import {analyzeContextKeyAccess} from './context-key-access.js';
import type {ResolvedField} from './resolved-field.js';
import {routeExpression} from './route-expression.js';
import {
  analyzeRunnerCalls,
  HASH_FILES_MAX_PATTERNS,
  type RunnerCall,
  type RunnerCallFunction,
} from './runner-call.js';

const templateExpressionOpen = '$' + '{{';
const runnerRootNotBareHint = `split runner-host references into their own adjacent ${templateExpressionOpen} }} segments`;
const runnerCallNotBareHint = `write the call as its own ${templateExpressionOpen} }} segment, next to the text around it`;

export type PlanViolation = {
  readonly reason:
    | 'runner-root-not-bare'
    | 'computed-context-key'
    | 'runner-call-not-bare'
    | 'runner-call-argument-not-literal'
    | 'runner-call-arity'
    | 'runner-call-in-field'
    | 'runner-call-pattern-invalid'
    | 'runner-call-pattern-outside-workspace';
  readonly source: string;
  readonly runnerRoots?: readonly string[];
  readonly contextRoots?: readonly string[];
  readonly function?: RunnerCallFunction;
  readonly pattern?: string;
  readonly hint: string;
};

export interface FieldPlan {
  readonly field: ResolvedField;
  readonly failurePolicy: WorkflowInterpolationFailurePolicy;
}

export type FieldPlanResult =
  | {readonly ok: true; readonly plan: FieldPlan}
  | {readonly ok: false; readonly violations: readonly PlanViolation[]};

export function planInterpolationField(params: {
  readonly field: WorkflowInterpolationField;
  readonly segments: readonly WorkflowTemplateSegment[];
}): FieldPlanResult {
  const violations: PlanViolation[] = [];
  const minimumFillTarget = getWorkflowInterpolationFieldMinimumFillTarget(params.field);
  const resolvedSegments: ResolvedField['segments'] = params.segments.map((segment) => {
    if (segment.kind === 'literal') return {kind: 'literal', value: segment.text};

    const route = routeExpression(segment.expression);
    const keyAccess = analyzeContextKeyAccess(segment.expression);
    const runnerCall = planRunnerCall(params.field, segment.expression.source, violations);
    if (runnerCall !== null) {
      return {
        kind: 'deferred',
        expression: segment.expression,
        roots: route.roots,
        fillTarget: route.fillTarget,
        ...(runnerCall === undefined ? {} : {runnerCall}),
      };
    }
    if (keyAccess.violations.length > 0) {
      violations.push(
        ...keyAccess.violations.map((violation) => ({
          reason: 'computed-context-key' as const,
          source: violation.source,
          contextRoots: [violation.root],
          hint: `${violation.root} references must use a literal dot key`,
        })),
      );
    } else if (route.runnerRoots.length > 0 && !isBareContextReference(segment.expression.source)) {
      violations.push({
        reason: 'runner-root-not-bare',
        source: segment.expression.source,
        runnerRoots: route.runnerRoots,
        hint: runnerRootNotBareHint,
      });
    }

    return {
      kind: 'deferred',
      expression: segment.expression,
      roots: route.roots,
      fillTarget: applyMinimumFillTarget(route.fillTarget, minimumFillTarget),
    };
  });

  if (violations.length > 0) return {ok: false, violations};

  return {
    ok: true,
    plan: {
      field: {segments: resolvedSegments},
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy(params.field),
    },
  };
}

/**
 * Returns `null` when the segment calls no runner function, the call when it can be planned, and
 * `undefined` after recording why it cannot.
 */
function planRunnerCall(
  field: WorkflowInterpolationField,
  source: string,
  violations: PlanViolation[],
): RunnerCall | undefined | null {
  const analysis = analyzeRunnerCalls(source);
  if (analysis.kind === 'none') return null;

  const fn = analysis.kind === 'bare' ? analysis.call.function : analysis.function;
  if (!workflowInterpolationFieldAcceptsRunnerCalls(field)) {
    violations.push({
      reason: 'runner-call-in-field',
      source,
      function: fn,
      hint: `${fn}() runs on the runner. Use it in env, with, or run`,
    });
    return undefined;
  }
  if (analysis.kind === 'not-bare') {
    violations.push({
      reason: 'runner-call-not-bare',
      source,
      function: fn,
      hint: runnerCallNotBareHint,
    });
    return undefined;
  }
  if (analysis.kind === 'arity') {
    violations.push({
      reason: 'runner-call-arity',
      source,
      function: fn,
      hint: `pass from 1 to ${HASH_FILES_MAX_PATTERNS} patterns`,
    });
    return undefined;
  }
  if (analysis.kind === 'argument-not-literal') {
    violations.push({
      reason: 'runner-call-argument-not-literal',
      source,
      function: fn,
      hint: `pass each ${fn}() pattern as a quoted string`,
    });
    return undefined;
  }
  const patternViolations = analysis.call.patterns.flatMap((pattern) =>
    patternViolation(source, fn, pattern),
  );
  if (patternViolations.length > 0) {
    violations.push(...patternViolations);
    return undefined;
  }
  return analysis.call;
}

// The runner hashes in the step working directory only: home and `/` differ between a runner
// and its job container, and a key built from them depends on the runner image.
function patternViolation(
  source: string,
  fn: RunnerCallFunction,
  pattern: string,
): PlanViolation[] {
  const parsed = parseAnchoredPattern(pattern);
  if (!parsed.ok && parsed.reason !== 'leaves-anchor' && parsed.reason !== 'whole-anchor') {
    return [
      {
        reason: 'runner-call-pattern-invalid',
        source,
        function: fn,
        pattern,
        hint:
          parsed.reason === 'empty'
            ? 'a pattern cannot be empty'
            : 'a pattern cannot contain a line break or NUL',
      },
    ];
  }
  if (!parsed.ok || parsed.anchor !== 'cwd') {
    return [
      {
        reason: 'runner-call-pattern-outside-workspace',
        source,
        function: fn,
        pattern,
        hint: 'patterns must name files inside the step working directory, without ~, a leading /, or ..',
      },
    ];
  }
  return [];
}

function applyMinimumFillTarget(
  fillTarget: FillTarget,
  minimumFillTarget: AvailabilitySite | undefined,
): FillTarget {
  if (minimumFillTarget === undefined || fillTarget === 'runner-fill') return fillTarget;

  const fillTargetIndex = availabilitySites.indexOf(fillTarget);
  const minimumFillTargetIndex = availabilitySites.indexOf(minimumFillTarget);
  if (fillTargetIndex < 0 || minimumFillTargetIndex < 0) return fillTarget;

  return availabilitySites[Math.max(fillTargetIndex, minimumFillTargetIndex)] ?? fillTarget;
}
