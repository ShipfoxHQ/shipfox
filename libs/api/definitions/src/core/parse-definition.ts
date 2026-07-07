import type {HarnessToolDeploymentConfig} from '@shipfox/api-agent-dto';
import type {IntegrationValidationContext} from './entities/integration-context.js';
import type {WorkflowDefinitionPayload} from './entities/workflow-definition.js';
import {DefinitionParseError} from './errors.js';
import {validateDefinition} from './validate-definition.js';

export function parseDefinition(
  yamlString: string,
  options?: {
    defaultRunnerLabels?: readonly string[];
    harnessToolDeploymentConfig?: HarnessToolDeploymentConfig;
    integrationValidationContext?: IntegrationValidationContext;
  },
): WorkflowDefinitionPayload {
  const result = validateDefinition(yamlString, options);

  if (!result.valid) {
    throw new DefinitionParseError(
      result.errors[0]?.message ?? 'Invalid definition',
      result.errors,
    );
  }

  return {
    ...result.definition,
    sourceSnapshot: {content: yamlString, format: 'yaml'},
  };
}
