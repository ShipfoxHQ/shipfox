import {
  evaluateWorkflowExpression,
  type WorkflowExpressionEvaluationContext,
  WorkflowExpressionEvaluationError,
} from '../evaluator/index.js';
import {parseWorkflowTemplate} from '../template/parse-workflow-template.js';
import type {WorkflowTemplateSegment} from '../template/template-segment.js';
import {coerceWorkflowValueToString} from './coerce-workflow-value-to-string.js';
import {WorkflowTemplateResolutionError} from './errors.js';

export type WorkflowTemplateFailurePolicy = 'fail' | 'degrade';

export interface WorkflowTemplateDiagnostic {
  readonly reason: 'missing-path';
  readonly expression: string;
  readonly contextRoots: readonly string[];
}

export interface WorkflowTemplateResolution {
  readonly value: string;
  readonly diagnostics: readonly WorkflowTemplateDiagnostic[];
}

export interface WorkflowTemplateResolutionOptions {
  readonly failurePolicy?: WorkflowTemplateFailurePolicy;
  readonly availableRoots?: readonly string[];
}

export function resolveWorkflowTemplate(
  segments: readonly WorkflowTemplateSegment[],
  context: WorkflowExpressionEvaluationContext,
  options: WorkflowTemplateResolutionOptions = {},
): WorkflowTemplateResolution {
  let value = '';
  const diagnostics: WorkflowTemplateDiagnostic[] = [];

  for (const segment of segments) {
    if (segment.kind === 'literal') {
      value += segment.text;
      continue;
    }

    try {
      value += coerceWorkflowValueToString(evaluateWorkflowExpression(segment.expression, context));
    } catch (error) {
      if (error instanceof WorkflowExpressionEvaluationError && error.reason === 'missing-path') {
        const diagnostic = {
          reason: 'missing-path',
          expression: segment.expression.source,
          contextRoots: segment.contextRoots,
        } as const satisfies WorkflowTemplateDiagnostic;

        if (missingPathRequiresFailure(segment, options)) {
          throw new WorkflowTemplateResolutionError({
            source: segment.expression.source,
            cause: error,
          });
        }

        diagnostics.push(diagnostic);
        continue;
      }

      throw new WorkflowTemplateResolutionError({
        source: segment.expression.source,
        cause: error,
      });
    }
  }

  return {value, diagnostics};
}

export function resolveWorkflowTemplateSource(
  source: string,
  context: WorkflowExpressionEvaluationContext,
  options?: WorkflowTemplateResolutionOptions,
): WorkflowTemplateResolution {
  return resolveWorkflowTemplate(parseWorkflowTemplate(source), context, options);
}

function missingPathRequiresFailure(
  segment: WorkflowTemplateSegment & {readonly kind: 'expr'},
  options: WorkflowTemplateResolutionOptions,
): boolean {
  if (options.failurePolicy !== 'fail') return false;
  const availableRoots = options.availableRoots ?? [];
  return segment.contextRoots.every((contextRoot) => availableRoots.includes(contextRoot));
}
