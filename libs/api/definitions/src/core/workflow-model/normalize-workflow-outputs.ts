import {buildTypedRootsEnvironment, type ExpressionType} from '@shipfox/expression';
import type {WorkflowDocument} from '@shipfox/workflow-document';
import type {
  WorkflowFieldTemplate,
  WorkflowModelJob,
  WorkflowOutputTemplates,
} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {inferJobOutputType} from './normalize-jobs.js';
import {parseInterpolationField} from './parse-interpolation-field.js';

export function normalizeWorkflowOutputs(params: {
  readonly outputs: WorkflowDocument['outputs'];
  readonly jobs: readonly WorkflowModelJob[];
  readonly issues: WorkflowModelValidationIssue[];
}):
  | {templates: WorkflowOutputTemplates; types: Readonly<Record<string, ExpressionType>>}
  | undefined {
  if (params.outputs === undefined) return undefined;

  // Every job has resolved when outputs are evaluated, so a job without declared
  // outputs exposes none: a reference to one of them fails the type check.
  const typeOverlay = buildTypedRootsEnvironment({
    jobs: params.jobs.map((job) => ({key: job.key, outputs: job.outputTypes ?? {}})),
  });
  const templates: Record<string, WorkflowFieldTemplate> = Object.create(null) as Record<
    string,
    WorkflowFieldTemplate
  >;
  const types: Record<string, ExpressionType> = Object.create(null) as Record<
    string,
    ExpressionType
  >;

  for (const [key, source] of Object.entries(params.outputs)) {
    const template = parseInterpolationField({
      field: 'workflow.outputs',
      source,
      path: ['outputs', key],
      issues: params.issues,
      fillSite: 'job-resolution',
      typeOverlay,
    }) ?? [{kind: 'literal' as const, value: source}];
    templates[key] = template;
    types[key] = inferJobOutputType(template);
  }

  return {templates, types};
}
