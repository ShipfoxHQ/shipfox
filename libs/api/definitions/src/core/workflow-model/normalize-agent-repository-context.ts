import type {AvailabilitySite, ExpressionTypeEnvironment} from '@shipfox/expression';
import type {WorkflowDocumentRepositoryContext} from '@shipfox/workflow-document';
import type {
  WorkflowFieldTemplate,
  WorkflowModelAgentRepositoryContext,
} from '../entities/workflow-model.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {parseInterpolationField} from './parse-interpolation-field.js';

interface NormalizedAgentRepositoryContext {
  /** Spread into the agent step: empty when the step omits the field. */
  readonly stepFields: {readonly repositoryContext?: WorkflowModelAgentRepositoryContext};
  readonly instructionsTemplate?: WorkflowFieldTemplate;
  readonly skillsTemplate?: WorkflowFieldTemplate;
}

type RepositoryContextToggle = boolean | string;

/**
 * Expands the short form into `instructions` and `skills`, so later stages only see the long
 * form. A template in the short form controls both.
 */
export function normalizeAgentRepositoryContext(params: {
  repositoryContext: WorkflowDocumentRepositoryContext | undefined;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): NormalizedAgentRepositoryContext {
  const {repositoryContext} = params;
  if (repositoryContext === undefined) return {stepFields: {}};
  const path = ['jobs', params.sourceName, 'steps', params.stepIndex, 'repository_context'];

  if (typeof repositoryContext === 'boolean' || typeof repositoryContext === 'string') {
    const template = toggleTemplate({...params, value: repositoryContext, path});
    return {
      stepFields: {
        repositoryContext: {instructions: repositoryContext, skills: repositoryContext},
      },
      ...(template === undefined ? {} : {instructionsTemplate: template, skillsTemplate: template}),
    };
  }

  const {instructions, skills} = repositoryContext;
  const instructionsTemplate =
    instructions === undefined
      ? undefined
      : toggleTemplate({...params, value: instructions, path: [...path, 'instructions']});
  const skillsTemplate =
    skills === undefined || Array.isArray(skills)
      ? undefined
      : toggleTemplate({...params, value: skills, path: [...path, 'skills']});
  return {
    stepFields: {
      repositoryContext: {
        ...(instructions === undefined ? {} : {instructions}),
        ...(skills === undefined
          ? {}
          : {skills: Array.isArray(skills) ? [...new Set(skills)] : skills}),
      },
    },
    ...(instructionsTemplate === undefined ? {} : {instructionsTemplate}),
    ...(skillsTemplate === undefined ? {} : {skillsTemplate}),
  };
}

function toggleTemplate(params: {
  value: RepositoryContextToggle;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): WorkflowFieldTemplate | undefined {
  if (typeof params.value === 'boolean') return undefined;
  return parseInterpolationField({
    field: 'agent.repository_context',
    source: params.value,
    path: params.path,
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });
}
