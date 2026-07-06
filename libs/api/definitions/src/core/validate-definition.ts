import type {HarnessToolDeploymentConfig} from '@shipfox/api-agent-dto';
import {InvalidWorkflowDocumentError} from '@shipfox/workflow-document';
import {definitionDefaultRunnerLabels, definitionHarnessToolDeploymentConfig} from '../config.js';
import type {WorkflowDefinitionPayload} from './entities/workflow-definition.js';
import {InvalidWorkflowModelError, normalizeWorkflowDocument} from './workflow-model/index.js';
import {InvalidWorkflowYamlError, parseWorkflowYamlWithLocations} from './workflow-yaml/index.js';

export type ValidationError = {message: string; path?: string | undefined};

export type ValidationResult =
  | {valid: true; definition: WorkflowDefinitionPayload}
  | {valid: false; errors: ValidationError[]};

export function validateDefinition(
  yamlContent: string,
  options: {
    defaultRunnerLabels?: readonly string[];
    harnessToolDeploymentConfig?: HarnessToolDeploymentConfig;
  } = {},
): ValidationResult {
  try {
    const {document, stepSourceLocations} = parseWorkflowYamlWithLocations(yamlContent);
    const model = normalizeWorkflowDocument(document, {
      defaultRunnerLabels: options.defaultRunnerLabels ?? definitionDefaultRunnerLabels,
      harnessToolDeploymentConfig:
        options.harnessToolDeploymentConfig ?? definitionHarnessToolDeploymentConfig,
      stepSourceLocations,
    });
    return {valid: true, definition: {document, model}};
  } catch (error) {
    return {valid: false, errors: validationErrorsFor(error)};
  }
}

function validationErrorsFor(error: unknown): ValidationError[] {
  if (error instanceof InvalidWorkflowYamlError) {
    return [
      validationError({
        message: error.message,
        path:
          error.location === undefined
            ? undefined
            : `${error.location.line}:${error.location.column}`,
      }),
    ];
  }

  if (error instanceof InvalidWorkflowDocumentError) {
    return error.validationError.issues.map((issue) =>
      validationError({
        message: issue.message,
        path: issue.path.join('.') || undefined,
      }),
    );
  }

  if (error instanceof InvalidWorkflowModelError) {
    return error.issues.map((issue) =>
      validationError({message: issue.message, path: issue.path.join('.')}),
    );
  }

  throw error;
}

function validationError(params: {message: string; path?: string | undefined}): ValidationError {
  if (params.path === undefined) return {message: params.message};
  return {message: params.message, path: params.path};
}
