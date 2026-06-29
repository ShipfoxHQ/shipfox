import {
  evaluateWorkflowExpression,
  type WorkflowExpressionEvaluationContext,
  WorkflowExpressionEvaluationError,
} from '../evaluator/index.js';
import {parseWorkflowTemplate} from '../template/parse-workflow-template.js';
import type {WorkflowTemplateSegment} from '../template/template-segment.js';
import {coerceWorkflowValueToString} from './coerce-workflow-value-to-string.js';
import {WorkflowTemplateResolutionError} from './errors.js';

export interface WorkflowTemplateDiagnostic {
  readonly reason: 'missing-path';
  readonly expression: string;
  readonly contextRoots: readonly string[];
}

export interface WorkflowTemplateResolution {
  readonly value: string;
  readonly diagnostics: readonly WorkflowTemplateDiagnostic[];
}

export function resolveWorkflowTemplate(
  segments: readonly WorkflowTemplateSegment[],
  context: WorkflowExpressionEvaluationContext,
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
        diagnostics.push({
          reason: 'missing-path',
          expression: segment.expression.source,
          contextRoots: segment.contextRoots,
        });
        continue;
      }

      throw new WorkflowTemplateResolutionError({
        expression: segment.expression.source,
        cause: error,
      });
    }
  }

  return {value, diagnostics};
}

export function resolveWorkflowTemplateSource(
  source: string,
  context: WorkflowExpressionEvaluationContext,
): WorkflowTemplateResolution {
  return resolveWorkflowTemplate(parseWorkflowTemplate(source), context);
}
