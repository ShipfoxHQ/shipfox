import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {
  agentRuntimeCredentialsResponseSchema,
  agentSessionDescriptorSchema,
  agentThinkingSchema,
  harnessSchema,
  managedProviderJobIdentitySchema,
  modelPriceSchema,
  modelProviderRefSchema,
  modelReferencesSchema,
  RUNNER_CAPABILITY_REQUIRED_ERROR_CODE,
  thinkingLevelsForHarness,
} from '#schemas/index.js';

const agentValidationCatalogFieldsSchema = z.object({
  providers: z.array(
    z.object({
      id: z.string().min(1),
      support_status: z.enum(['supported', 'unsupported']),
    }),
  ),
  harnesses: z.array(
    z.object({
      id: harnessSchema,
      supported_provider_ids: z.array(z.string().min(1)),
      model_ids_by_provider: z.record(z.string().min(1), z.array(z.string().min(1))).optional(),
      thinking_levels: z.array(agentThinkingSchema),
      effective_tools: z.array(z.string().min(1)),
    }),
  ),
});

const agentValidationCatalogSchema = agentValidationCatalogFieldsSchema.extend({
  version: z.literal(1),
});

const agentValidationCatalogV2Schema = agentValidationCatalogFieldsSchema.extend({
  version: z.literal(2),
  default_harness_id: harnessSchema,
});

export type AgentValidationCatalog = z.infer<typeof agentValidationCatalogSchema>;
export type AgentValidationCatalogV2 = z.infer<typeof agentValidationCatalogV2Schema>;

const agentWorkspaceModelSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).nullable().optional().default(null),
    lab: z.string().min(1).nullable().optional().default(null),
    provider: modelProviderRefSchema,
    harness: harnessSchema,
    thinking: agentThinkingSchema,
    supported_thinking: z.array(agentThinkingSchema),
    is_default: z.boolean(),
    price: modelPriceSchema.nullable(),
    references: modelReferencesSchema,
  })
  .superRefine(({harness, supported_thinking: supportedThinking, references}, ctx) => {
    const supportedLevels = new Set(supportedThinking);
    const harnessLevels = new Set(thinkingLevelsForHarness(harness));

    for (const [index, level] of supportedThinking.entries()) {
      if (!harnessLevels.has(level)) {
        ctx.addIssue({
          code: 'custom',
          path: ['supported_thinking', index],
          message: 'supported_thinking must contain levels supported by the model harness',
        });
      }
      if (supportedThinking.indexOf(level) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['supported_thinking', index],
          message: 'supported_thinking must not contain duplicate levels',
        });
      }
    }

    for (const [index, reference] of references.entries()) {
      if (!supportedLevels.has(reference.thinking) || !harnessLevels.has(reference.thinking)) {
        ctx.addIssue({
          code: 'custom',
          path: ['references', index, 'thinking'],
          message: 'reference thinking must be supported by the model and harness',
        });
      }
    }
  });

const agentWorkspaceModelsSchema = z
  .object({
    models: z.array(agentWorkspaceModelSchema),
    default_model: agentWorkspaceModelSchema.nullable(),
    attribution: z.string().min(1).nullable(),
  })
  .superRefine(({models, default_model: defaultModel, attribution}, ctx) => {
    const hasReferencedModel = models.some(({references}) => references.length > 0);
    if ((attribution !== null) !== hasReferencedModel) {
      ctx.addIssue({
        code: 'custom',
        path: ['attribution'],
        message: hasReferencedModel
          ? 'attribution is required when a model has references'
          : 'attribution must be null when no model has references',
      });
    }

    const markedDefaultModels = models.filter(({is_default: isDefault}) => isDefault);
    if (defaultModel === null) {
      if (markedDefaultModels.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['models'],
          message: 'models must not mark a default when default_model is null',
        });
      }
      return;
    }

    if (
      !models.some(({id, provider}) => id === defaultModel.id && provider === defaultModel.provider)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['default_model'],
        message: 'default_model must be null or one of models',
      });
      return;
    }

    const markedDefaultModel = markedDefaultModels[0];
    if (
      !defaultModel.is_default ||
      markedDefaultModels.length !== 1 ||
      markedDefaultModel?.id !== defaultModel.id ||
      markedDefaultModel?.provider !== defaultModel.provider
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['default_model'],
        message: 'default_model must match the only model marked as default',
      });
    }
  });

export type AgentWorkspaceModel = z.infer<typeof agentWorkspaceModelSchema>;
export type AgentWorkspaceModels = z.infer<typeof agentWorkspaceModelsSchema>;

const agentConfigInputSchema = z.object({
  harness: harnessSchema.optional(),
  provider: modelProviderRefSchema.optional(),
  model: z.string().optional(),
  // A resolved template may contain any string; the agent module validates it
  // against the resolved harness and returns the domain error if it is invalid.
  thinking: z.string().optional(),
});

const resolvedAgentConfigSchema = z.object({
  harness: harnessSchema,
  provider: modelProviderRefSchema,
  model: z.string(),
  thinking: agentThinkingSchema,
});

export {type AgentSessionDescriptorDto, agentSessionDescriptorSchema} from '#schemas/index.js';

export const agentInterModuleContract = defineInterModuleContract({
  module: 'agent',
  methods: {
    getValidationCatalog: {
      input: z.object({}),
      output: agentValidationCatalogSchema,
      errors: {},
    },
    getValidationCatalogV2: {
      input: z.object({workspaceId: z.string().uuid().nullable()}),
      output: agentValidationCatalogV2Schema,
      errors: {},
    },
    getWorkspaceModels: {
      input: z.object({workspaceId: z.string().uuid()}),
      output: agentWorkspaceModelsSchema,
      errors: {},
    },
    resolveAgentConfig: {
      input: z.object({workspaceId: z.string().uuid().nullable(), config: agentConfigInputSchema}),
      output: resolvedAgentConfigSchema,
      errors: {
        'agent-config-invalid': z.object({
          message: z.string().min(1).optional(),
          managed_provider_id: modelProviderRefSchema.optional(),
        }),
      },
    },
    resolveRuntimeCredentials: {
      input: z.object({
        workspaceId: z.string().uuid(),
        runId: z.string().uuid(),
        stepAttemptId: z.string().uuid(),
        jobIdentity: managedProviderJobIdentitySchema.optional(),
        renewableInference: z.boolean(),
        harness: harnessSchema,
        provider: modelProviderRefSchema,
        model: z.string(),
        thinking: agentThinkingSchema,
      }),
      output: agentRuntimeCredentialsResponseSchema,
      errors: {
        'model-provider-not-configured': z.object({}),
        'model-provider-credentials-invalid': z.object({}),
        [RUNNER_CAPABILITY_REQUIRED_ERROR_CODE]: z.object({}),
        'workspace-providers-disabled': z.object({
          message: z.string().min(1).optional(),
          managed_provider_id: modelProviderRefSchema,
        }),
      },
    },
    claimSession: {
      input: z.object({
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid(),
        workflowRunAttemptId: z.string().uuid(),
        key: z.string().min(1),
        /**
         * Resolved harness sent by the caller, including when the step omitted it.
         * When `harnessExplicit` is false, an existing session's pinned harness
         * takes precedence over this value.
         */
        harness: harnessSchema,
        /** Whether the caller authored the harness; false requests pin inheritance. */
        harnessExplicit: z.boolean().optional(),
        stepAttemptId: z.string().uuid(),
        /** `resume` claims exclusively and may write back; `fork` only reads the current head. */
        mode: z.enum(['resume', 'fork']),
      }),
      output: z.object({
        /** Null when a `fork` targets a session that does not exist yet: the step runs fresh and creates nothing. */
        descriptor: agentSessionDescriptorSchema.nullable(),
        /** Harness the session is pinned to (the resolved harness when no session exists). */
        harness: harnessSchema,
      }),
      errors: {
        'session-key-invalid': z.object({}),
        'session-held': z.object({
          holder: z
            .object({sessionId: z.string().uuid(), stepAttemptId: z.string().uuid()})
            .optional(),
        }),
        'session-harness-mismatch': z.object({}),
        'session-lock-unavailable': z.object({}),
      },
    },
    releaseSession: {
      input: z.object({
        sessionId: z.string().uuid(),
        stepAttemptId: z.string().uuid(),
      }),
      output: z.object({released: z.boolean()}),
    },
    carryOverSessions: {
      input: z.object({
        fromWorkflowRunAttemptId: z.string().uuid(),
        toWorkflowRunAttemptId: z.string().uuid(),
      }),
      output: z.object({
        sessions: z.array(
          z.object({
            id: z.string().uuid(),
            key: z.string().min(1),
            segment: z.number().int().nonnegative(),
          }),
        ),
      }),
      errors: {
        'carry-over-conflict': z.object({}),
      },
    },
  },
});

export type AgentInterModuleClient = InterModuleClient<typeof agentInterModuleContract>;
