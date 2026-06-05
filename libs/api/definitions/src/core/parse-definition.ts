import type {SurfaceWorkflowDocument} from './entities/definition.js';
import {DefinitionParseError} from './errors.js';
import {validateDefinition} from './validate-definition.js';

export function parseDefinition(yamlString: string): SurfaceWorkflowDocument {
  const result = validateDefinition(yamlString);

  if (!result.valid) {
    throw new DefinitionParseError(
      result.errors[0]?.message ?? 'Invalid definition',
      result.errors,
    );
  }

  return result.document;
}
