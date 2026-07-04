export {
  WorkflowExpressionEvaluationError,
  type WorkflowExpressionEvaluationFailureReason,
  workflowExpressionEvaluationErrorCode,
} from './evaluator/errors.js';
export {
  evaluateWorkflowExpression,
  evaluateWorkflowPredicate,
  evaluateWorkflowPredicateFailClosed,
  type FailClosedPredicateOutcome,
  type WorkflowExpressionEvaluationContext,
  type WorkflowExpressionEvaluationValue,
} from './evaluator/evaluate-workflow-expression.js';
export {
  createWorkflowExpression,
  unsafeWorkflowExpressionFromSource,
} from './expression/create-workflow-expression.js';
export {
  InvalidWorkflowExpressionError,
  invalidWorkflowExpressionErrorCode,
} from './expression/errors.js';
export type {
  CreateWorkflowExpressionParams,
  ExpressionScalarType,
  ExpressionType,
  ExpressionTypeEnvironment,
  ValidCelExpression,
  WorkflowExpression,
  WorkflowExpressionCheck,
  WorkflowExpressionCheckOptions,
} from './expression/workflow-expression.js';
export {isBareContextReference} from './plan/bare-reference.js';
export {
  analyzeContextKeyAccess,
  type ContextKeyAccessAnalysis,
  type ContextKeyAccessReference,
  type ContextKeyAccessViolation,
} from './plan/context-key-access.js';
export {evaluatePlannedPredicateAtSite} from './plan/evaluate-planned-predicate.js';
export {extractExactContextRoots} from './plan/extract-exact-context-roots.js';
export {
  type FrozenResolvedField,
  freezeResolvedFieldAtSite,
  resolveFieldAtSite,
  type SiteResolvedField,
  type WorkflowTemplateDiagnostic,
  type WorkflowTemplateFailurePolicy,
} from './plan/freeze.js';
export {
  type FrozenPlannedRunCommand,
  freezePlannedRunCommandAtSite,
} from './plan/freeze-run-command.js';
export {
  type FieldPlan,
  type FieldPlanResult,
  type PlanViolation,
  planInterpolationField,
} from './plan/plan-field.js';
export type {
  ResolvedField,
  ResolvedFieldDeferredSegment,
  ResolvedFieldLiteralSegment,
  ResolvedFieldSegment,
} from './plan/resolved-field.js';
export {
  type ServerEvaluabilityResult,
  type ServerEvaluabilityViolation,
  validateServerEvaluable,
} from './plan/validate-server-evaluable.js';
export {
  WorkflowTemplateResolutionError,
  workflowTemplateResolutionErrorCode,
} from './resolver/errors.js';
export {
  type HoistedPlannedRunCommand,
  hoistPlannedRunCommand,
  type PlannedRunCommandBinding,
  type RunCommandHoistOptions,
  UnsafeRunInterpolationError,
  unsafeRunInterpolationErrorCode,
} from './run/hoist-run-command.js';
export {
  InvalidWorkflowTemplateError,
  invalidWorkflowTemplateErrorCode,
} from './template/errors.js';
export {extractCelContextRoots} from './template/extract-cel-context-roots.js';
export {extractCelUntrustedPathAccesses} from './template/extract-cel-untrusted-path-accesses.js';
export {parseWorkflowTemplate} from './template/parse-workflow-template.js';
export type {
  WorkflowTemplateExprSegment,
  WorkflowTemplateLiteralSegment,
  WorkflowTemplateSegment,
} from './template/template-segment.js';
export {
  type AvailabilitySite,
  availabilitySites,
  type FillTarget,
  getWorkflowContextAvailability,
  getWorkflowContextDefinition,
  getWorkflowContextHost,
  getWorkflowContextSensitivity,
  getWorkflowContextTypeEnvironment,
  getWorkflowContextUntrustedPaths,
  getWorkflowInterpolationFieldFailurePolicy,
  type OpenWorkflowContextDefinition,
  type ReservedRootDefinition,
  type RunnerWorkflowContextDefinition,
  resolveContextRootAvailability,
  resolveContextRootHost,
  rootsAvailableAt,
  runnerFillTarget,
  type TypedWorkflowContextDefinition,
  unavailableRootsAt,
  type WorkflowContextAvailabilityReferenceEntry,
  type WorkflowContextDefinition,
  type WorkflowContextHost,
  type WorkflowContextName,
  type WorkflowContextReservedRoot,
  type WorkflowContextSensitivity,
  type WorkflowContextShape,
  type WorkflowContextTrustTier,
  type WorkflowFieldFailurePolicy,
  type WorkflowInterpolationFailurePolicy,
  type WorkflowInterpolationField,
  type WorkflowInterpolationFieldPolicy,
  type WorkflowPredicateField,
  workflowContextAvailabilityReference,
  workflowContextDefinitions,
  workflowContextHosts,
  workflowContextNames,
  workflowContextReservedRoots,
  workflowContextRootRequiresLiteralKey,
  workflowContextSensitivities,
  workflowContextTrustTiers,
  workflowFieldFailurePolicies,
  workflowInterpolationFieldAcceptsContext,
  workflowInterpolationFieldAcceptsHost,
  workflowInterpolationFieldAcceptsTrustTier,
  workflowInterpolationFieldPolicies,
  workflowInterpolationFields,
  workflowPredicateFieldFailurePolicy,
  workflowPredicateFields,
} from './workflow-context/workflow-context.js';
