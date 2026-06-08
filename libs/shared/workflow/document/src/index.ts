export {
  validateWorkflowDocument,
  type WorkflowDocument,
  type WorkflowDocumentDiagnostic,
  type WorkflowDocumentDiagnosticCode,
  type WorkflowDocumentDiagnosticPathSegment,
  type WorkflowDocumentDiagnosticSeverity,
  type WorkflowDocumentJob,
  type WorkflowDocumentRunStep,
  type WorkflowDocumentTrigger,
  type WorkflowDocumentValidationResult,
  workflowDocumentJobSchema,
  workflowDocumentRunStepSchema,
  workflowDocumentSchema,
  workflowDocumentTriggerSchema,
} from '#document/index.js';
export {simpleBuildWorkflowDocument} from '#examples/simple-build.js';
