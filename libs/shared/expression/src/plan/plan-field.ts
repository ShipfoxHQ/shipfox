import type {WorkflowTemplateSegment} from '../template/template-segment.js';
import {
  getWorkflowInterpolationFieldFailurePolicy,
  type WorkflowInterpolationFailurePolicy,
  type WorkflowInterpolationField,
} from '../workflow-context/workflow-context.js';
import {isBareContextReference} from './bare-reference.js';
import type {ResolvedField} from './resolved-field.js';
import {routeExpression} from './route-expression.js';

const templateExpressionOpen = '$' + '{{';
const runnerRootNotBareHint = `split runner-host references into their own adjacent ${templateExpressionOpen} }} segments`;

export type PlanViolation = {
  readonly reason: 'runner-root-not-bare';
  readonly source: string;
  readonly runnerRoots: readonly string[];
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
    if (route.runnerRoots.length > 0 && !isBareContextReference(segment.expression.source)) {
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
