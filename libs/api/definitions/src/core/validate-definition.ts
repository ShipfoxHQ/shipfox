import {
  parseYamlSurfaceWorkflowDocument,
  type SurfaceWorkflowDocument,
  type SurfaceWorkflowDocumentValidationError,
} from '@shipfox/api-workflow-language';
import {DagValidationError, validateDag} from './validate-dag.js';

export type ValidationError = SurfaceWorkflowDocumentValidationError;

export type ValidationResult =
  | {valid: true; document: SurfaceWorkflowDocument}
  | {valid: false; errors: ValidationError[]};

export function validateDefinition(yamlContent: string): ValidationResult {
  const result = parseYamlSurfaceWorkflowDocument(yamlContent);
  if (!result.valid) return result;

  const {document} = result;

  try {
    validateDag(document.jobs);
  } catch (error) {
    if (error instanceof DagValidationError) {
      return {
        valid: false,
        errors: [{message: error.message, path: error.cycle?.join(' -> ')}],
      };
    }
    throw error;
  }

  return {valid: true, document};
}
