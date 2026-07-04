import type {WorkflowTemplateSegment} from '../template/template-segment.js';
import {
  getWorkflowInterpolationFieldFailurePolicy,
  type WorkflowInterpolationFailurePolicy,
  type WorkflowInterpolationField,
} from '../workflow-context/workflow-context.js';
import {isBareContextReference} from './bare-reference.js';
import {analyzeContextKeyAccess} from './context-key-access.js';
import type {ResolvedField} from './resolved-field.js';
import {routeExpression} from './route-expression.js';

const templateExpressionOpen = '$' + '{{';
const runnerRootNotBareHint = `split runner-host references into their own adjacent ${templateExpressionOpen} }} segments`;

export type PlanViolation = {
  readonly reason: 'runner-root-not-bare' | 'computed-context-key';
  readonly source: string;
  readonly runnerRoots?: readonly string[];
  readonly contextRoots?: readonly string[];
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
  const resolvedSegments: ResolvedField['segments'] = params.segments.map((segment) => {
    if (segment.kind === 'literal') return {kind: 'literal', value: segment.text};

    const route = routeExpression(segment.expression);
    const keyAccess = analyzeContextKeyAccess(segment.expression);
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
      fillTarget: route.fillTarget,
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
