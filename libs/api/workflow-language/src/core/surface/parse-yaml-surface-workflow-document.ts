import yaml from 'js-yaml';
import {
  type SurfaceWorkflowDocumentValidationResult,
  validateSurfaceWorkflowDocument,
} from './surface-workflow-document.js';

export function parseYamlSurfaceWorkflowDocument(
  yamlContent: string,
): SurfaceWorkflowDocumentValidationResult {
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlContent);
  } catch (error) {
    return {
      valid: false,
      errors: [
        {message: `Invalid YAML syntax: ${error instanceof Error ? error.message : String(error)}`},
      ],
    };
  }

  return validateSurfaceWorkflowDocument(parsed);
}
