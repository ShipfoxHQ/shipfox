import {
  normalizeSurfaceDocumentToWorkflowIR,
  parseYamlSurfaceWorkflowDocument,
  type StaticDiagnostic,
  type SurfaceWorkflowDocument,
  type SurfaceWorkflowDocumentValidationError,
  validateWorkflowIRStaticSemantics,
} from '@shipfox/api-workflow-language';

export type ValidationError = SurfaceWorkflowDocumentValidationError;

export type ValidationResult =
  | {valid: true; document: SurfaceWorkflowDocument}
  | {valid: false; errors: ValidationError[]};

export function validateDefinition(yamlContent: string): ValidationResult {
  const result = parseYamlSurfaceWorkflowDocument(yamlContent);
  if (!result.valid) return result;

  const {document} = result;

  const ir = normalizeSurfaceDocumentToWorkflowIR(document);
  const staticResult = validateWorkflowIRStaticSemantics(ir);
  if (!staticResult.valid) {
    return {
      valid: false,
      errors: staticResult.diagnostics.map(toValidationError),
    };
  }

  return {valid: true, document};
}

function toValidationError(diagnostic: StaticDiagnostic): ValidationError {
  return {
    message: diagnostic.message,
    path: diagnostic.path.join('.'),
  };
}
