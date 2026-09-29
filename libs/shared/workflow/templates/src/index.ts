export {computeTemplateBump, type TemplateBump, type TemplateManifestChange} from './bump.js';
export {
  type ApplyTemplateOptionsInput,
  applyTemplateOptions,
  type ComposeTemplateInput,
  composeTemplate,
  composeWorkflow,
  composeWorkflowTemplate,
  type PartBlocks,
  type TemplateHeaderChoice,
  type TemplateOptions,
  type TemplateRoleBindings,
  type TemplateVariant,
  templateRoleBindings,
  templateVariants,
} from './composer.js';
export {
  assertSupportedComposition,
  CURRENT_COMPOSITION,
  SUPPORTED_COMPOSITIONS,
  UnsupportedCompositionError,
} from './composition.js';
export {
  formatTemplateHeader,
  type LegacyTemplateHeader,
  parseTemplateHeader,
  type RegistryTemplateHeader,
  type TemplateHeader,
} from './header.js';
export {
  createTemplateLoader,
  type EmbeddedWorkflowTemplateAsset,
  FIRST_PARTY_TEMPLATE_NAMESPACE,
  loadShippedTemplates,
  resolveTemplatePackage,
  shippedTemplateLoader,
  type TemplateLoader,
  type WorkflowTemplate,
  type WorkflowTemplateAsset,
} from './loader.js';
export {
  manifestSchema,
  optionSchema,
  roleSchema,
  templateManifestSchema,
  type WorkflowTemplateFlowStep,
  type WorkflowTemplateManifest,
  type WorkflowTemplateModel,
  type WorkflowTemplateOption,
  type WorkflowTemplateOptionChoice,
  type WorkflowTemplatePrerequisite,
  type WorkflowTemplateRole,
  type WorkflowTemplateSecret,
  type WorkflowTemplateSlot,
  type WorkflowTemplateVariable,
  type WorkflowTemplateWrite,
  workflowTemplateFlowStepSchema,
  workflowTemplateManifestSchema,
  workflowTemplateModelSchema,
  workflowTemplateOptionChoiceSchema,
  workflowTemplateOptionSchema,
  workflowTemplatePrerequisiteSchema,
  workflowTemplateRoleSchema,
  workflowTemplateSecretSchema,
  workflowTemplateSlotSchema,
  workflowTemplateVariableSchema,
  workflowTemplateWriteSchema,
} from './manifest.js';
export {
  type DeriveTemplateMetadataParams,
  deriveTemplateMetadata,
  type WorkflowTemplateMetadata,
  workflowTemplateMetadataSchema,
} from './metadata.js';
export {
  extractModelAnchors,
  validateModelAnchors,
  type WorkflowModelAnchor,
  type WorkflowModelAnchors,
} from './model-anchors.js';
export {
  type BuildTemplatePromptInput,
  type BuildUpgradePromptInput,
  buildTemplatePrompt,
  buildUpgradePrompt,
} from './prompt.js';
export {
  CHEAPER_RATIO,
  type CostTradeoff,
  type IntelligenceTradeoff,
  MORE_EXPENSIVE_RATIO,
  type ModelRecommendation,
  type ModelTradeoff,
  MUCH_CHEAPER_RATIO,
  MUCH_MORE_EXPENSIVE_RATIO,
  RECOMMENDATION_INDEX_BAND,
  type RecommendationAnchor,
  type RecommendationModel,
  type RecommendationReference,
  type RecommendModelsInput,
  recommendModels,
  SIMILAR_INTELLIGENCE_BAND,
} from './recommend-models.js';
export {
  getShippedSkillResource,
  listShippedSkillResources,
  type SkillResource,
} from './skills.js';
