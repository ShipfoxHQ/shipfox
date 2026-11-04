import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {
  agentConfigInvalidReasonSchema,
  agentRuntimeCredentialsResponseSchema,
  agentSessionDescriptorSchema,
  agentThinkingSchema,
  harnessSchema,
  inferenceSubjectSchema,
  MODEL_UNAVAILABLE_ERROR_CODE,
  modelPriceSchema,
  modelProviderRefSchema,
  modelReferencesSchema,
  modelUnavailableDetailsSchema,
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
  /** Managed model ids the workspace cannot run right now, by provider. Validation only warns. */
  locked_model_ids_by_provider: z.record(z.string().min(1), z.array(z.string().min(1))).optional(),
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
    managed_provider_id: modelProviderRefSchema.nullable().optional().default(null),
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

export const MAX_CONVERSATION_KEY_LENGTH = 256;

const interactionRoutingInputSchema = z.object({
  /** The provider's opaque key. The cap keeps it inside a unique index entry. */
  conversationKey: z.string().min(1).max(MAX_CONVERSATION_KEY_LENGTH),
  role: z.enum(['request', 'follow_up', 'stop']),
  /** Prose for the model. Treated as untrusted data. */
  text: z.string(),
  /** Absent when no person caused the interaction. */
  author: z.object({externalId: z.string().min(1), displayName: z.string().optional()}).optional(),
});

export const interactionRoutingResultSchema = z.discriminatedUnion('outcome', [
  /** The conversation that already owns the key took the interaction. */
  z.object({
    outcome: z.literal('owner'),
    conversationId: z.string().uuid(),
    projectId: z.string().uuid(),
    agentKey: z.string().min(1),
  }),
  /** A new request started a conversation with the workspace's default agent. */
  z.object({
    outcome: z.literal('default'),
    conversationId: z.string().uuid(),
    projectId: z.string().uuid(),
    agentKey: z.string().min(1),
  }),
  /**
   * No agent took the interaction. `project-access` means the project's access excludes the
   * connection, and `project-deleted` means the project is gone. Neither is worth a replay.
   */
  z.object({
    outcome: z.literal('dropped'),
    reason: z.enum(['no-owner', 'no-project', 'project-access', 'project-deleted']),
  }),
]);
export type InteractionRoutingResult = z.infer<typeof interactionRoutingResultSchema>;

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
          reason: agentConfigInvalidReasonSchema,
          message: z.string().min(1).optional(),
          model: z.string().optional(),
          provider: z.string().optional(),
          managed_provider_id: modelProviderRefSchema.optional(),
        }),
      },
    },
    resolveRuntimeCredentials: {
      input: z.object({
        workspaceId: z.string().uuid(),
        subject: inferenceSubjectSchema,
        /**
         * Marks a later credential for admitted work, which skips the model availability check: a
         * refresh of a running step, or any model or summary call after a turn's first model call.
         */
        renewal: z.boolean().optional(),
        harness: harnessSchema,
        provider: modelProviderRefSchema,
        model: z.string(),
        thinking: agentThinkingSchema,
      }),
      output: agentRuntimeCredentialsResponseSchema,
      errors: {
        'model-provider-not-configured': z.object({}),
        'model-provider-credentials-invalid': z.object({}),
        [MODEL_UNAVAILABLE_ERROR_CODE]: modelUnavailableDetailsSchema,
        'model-availability-unavailable': z.object({}),
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
    /**
     * Gives an integration interaction to the agent that owns its conversation, or starts one with
     * the default agent. A follow-up or stop with no owner is dropped. The delivery key makes a
     * replayed event post its text once.
     */
    routeInteraction: {
      input: z.object({
        workspaceId: z.string().uuid(),
        connectionId: z.string().uuid(),
        provider: z.string().min(1),
        deliveryKey: z.string().min(1),
        interaction: interactionRoutingInputSchema,
      }),
      output: interactionRoutingResultSchema,
    },
    /**
     * Spends one run start from a conversation's budget. A message from a person gives the budget
     * back. `claimed` is false once the budget is used.
     */
    claimConversationRunStart: {
      input: z.object({workspaceId: z.string().uuid(), conversationId: z.string().uuid()}),
      output: z.object({claimed: z.boolean()}),
    },
    /**
     * Links a run to the conversation that started it, so the run's result joins that conversation
     * when the run settles or ends. A repeat changes nothing. `registered` is false when the
     * conversation is gone or belongs to another workspace.
     */
    registerConversationRun: {
      input: z.object({
        workspaceId: z.string().uuid(),
        conversationId: z.string().uuid(),
        workflowRunId: z.string().uuid(),
      }),
      output: z.object({registered: z.boolean()}),
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
