import type {AvailabilitySite} from '@shipfox/expression';
import type {WorkflowEnvTemplates, WorkflowFieldTemplate} from '../entities/workflow-model.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {parseInterpolationField} from './parse-interpolation-field.js';

export function normalizeEnv(params: {
  env: Readonly<Record<string, string | number | boolean>> | undefined;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
  fillSite?: AvailabilitySite;
  allowedJobReferences?: ReadonlySet<string>;
}): {env?: Readonly<Record<string, string>>; templates?: {env: WorkflowEnvTemplates}} {
  const env = params.env;
  if (env === undefined || Object.keys(env).length === 0) return {};

  const normalizedEnv: Record<string, string> = Object.create(null) as Record<string, string>;
  const templates: Record<string, WorkflowFieldTemplate> = Object.create(null) as Record<
    string,
    WorkflowFieldTemplate
  >;

  for (const [key, value] of Object.entries(env)) {
    normalizedEnv[key] = String(value);
    if (typeof value !== 'string') continue;

    const template = parseInterpolationField({
      field: 'env.value',
      source: value,
      path: [...params.path, key],
      issues: params.issues,
      ...(params.fillSite === undefined ? {} : {fillSite: params.fillSite}),
      ...(params.allowedJobReferences === undefined
        ? {}
        : {allowedJobReferences: params.allowedJobReferences}),
    });
    if (template !== undefined) templates[key] = template;
  }

  return {
    env: normalizedEnv,
    ...(Object.keys(templates).length === 0 ? {} : {templates: {env: templates}}),
  };
}
