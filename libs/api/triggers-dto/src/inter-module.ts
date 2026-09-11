import {definitionValidationErrorSchema} from '@shipfox/api-definitions-dto';
import {
  workflowDiagnosticFieldSchema,
  workflowExecutionPayloadFieldSchema,
} from '@shipfox/api-workflows-dto';
import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {isSafeRefInput} from '@shipfox/regex';
import {z} from 'zod';
import {
  listenerMatcherKindSchema,
  triggerDecisionOutcomeSchema,
  triggerDecisionSubscriptionKindSchema,
  triggerEventOriginSchema,
  triggerEventOutcomeSchema,
} from './schemas/trigger-events.js';

const idSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime();
const refSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(isSafeRefInput, 'Ref contains a control character');
const configPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(isSafeRefInput, 'Config path contains a control character');
const diagnosticVersionSchema = z.literal(1);
const diagnosticByteCountSchema = z.number().int().nonnegative();
const diagnosticFieldSchema = z.string().min(1).max(200);
const diagnosticIndexSchema = z.number().int().min(-999_999_999).max(999_999_999);

export const triggerDecisionDiagnosticSchema = z.discriminatedUnion('code', [
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('expression-missing-path'),
    path: z.string().min(1).max(200),
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('expression-index-out-of-bounds'),
    index: diagnosticIndexSchema,
    size: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('expression-syntax-invalid'),
    summary: z.string().min(1).max(200),
    offset: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('expression-evaluation-failed'),
    classification: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .optional(),
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('expression-result-not-boolean'),
    actualType: z.enum(['string', 'int', 'double', 'null', 'list', 'map', 'unknown']),
  }),
  ...[
    'filter-config-invalid',
    'listener-snapshot-invalid',
    'listener-output-types-invalid',
    'admission-denied',
    'workspace-not-found',
    'workspace-suspended',
    'workspace-deleted',
    'definition-not-found',
    'project-mismatch',
    'agent-config-unresolvable',
    'agent-integration-materialization-failed',
    'unexpected-workflow-start-failure',
    'unexpected-listener-delivery-failure',
  ].map((code) => z.strictObject({version: diagnosticVersionSchema, code: z.literal(code)})),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('interpolation-unresolvable'),
    field: diagnosticFieldSchema,
    envKey: diagnosticFieldSchema.optional(),
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('invalid-job-runner-labels'),
    labels: z.array(z.string().min(1).max(64)).min(1).max(10),
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('source-snapshot-too-large'),
    limitBytes: diagnosticByteCountSchema,
    measuredBytes: diagnosticByteCountSchema,
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('diagnostic-too-large'),
    field: diagnosticFieldSchema.optional(),
    limitBytes: diagnosticByteCountSchema,
    measuredBytes: diagnosticByteCountSchema,
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('workflow-execution-payload-too-large'),
    field: diagnosticFieldSchema,
    limitBytes: diagnosticByteCountSchema,
    measuredBytes: diagnosticByteCountSchema,
    overshootBytes: diagnosticByteCountSchema,
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('listener-event-payload-too-large'),
    limitBytes: diagnosticByteCountSchema,
    measuredBytes: diagnosticByteCountSchema,
    overshootBytes: diagnosticByteCountSchema,
  }),
]);

export const triggerEventProcessingDiagnosticSchema = z.strictObject({
  version: diagnosticVersionSchema,
  code: z.enum([
    'subscription-load-failed',
    'trigger-reference-resolution-failed',
    'listener-routing-failed',
    'event-processing-failed',
  ]),
});

const triggerEventCursorSchema = z.object({
  receivedAt: isoDateTimeSchema,
  id: idSchema,
});

const triggerEventListFiltersSchema = z
  .object({
    source: z.array(z.string()).optional(),
    event: z.array(z.string()).optional(),
    origin: z.array(triggerEventOriginSchema).optional(),
    outcome: z.array(triggerEventOutcomeSchema).optional(),
    replayable: z.literal(true).optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && new Date(value.from) > new Date(value.to)) {
      ctx.addIssue({
        code: 'custom',
        message: 'from must be before or equal to to',
        path: ['from'],
      });
    }
  });

const triggerEventListItemSchema = z.object({
  id: idSchema,
  eventRef: z.string(),
  origin: triggerEventOriginSchema,
  workspaceId: idSchema,
  provider: z.string().nullable(),
  source: z.string(),
  event: z.string(),
  replayOfEventId: idSchema.nullable(),
  deliveryId: z.string().nullable(),
  connectionId: idSchema.nullable(),
  connectionName: z.string().nullable(),
  outcome: triggerEventOutcomeSchema,
  matchedCount: z.number().int().nonnegative(),
  receivedAt: isoDateTimeSchema,
  processedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

const triggerEventSchema = triggerEventListItemSchema.extend({
  payload: z.record(z.string(), z.unknown()).nullable(),
  processingDiagnostic: triggerEventProcessingDiagnosticSchema.nullable().optional(),
});

const triggerEventReplaySchema = z.object({
  id: idSchema,
  receivedAt: isoDateTimeSchema,
  outcome: triggerEventOutcomeSchema,
  runId: idSchema.nullable(),
});

const triggerDecisionSchema = z
  .object({
    id: idSchema,
    receivedEventId: idSchema,
    subscriptionKind: triggerDecisionSubscriptionKindSchema,
    subscriptionId: idSchema.nullable(),
    subscriptionName: z.string(),
    workflowDefinitionId: idSchema.nullable(),
    projectId: idSchema.nullable(),
    workflowRunId: idSchema.nullable(),
    jobId: idSchema.nullable(),
    matcherKind: listenerMatcherKindSchema.nullable(),
    matcherOrdinal: z.number().int().nonnegative().nullable(),
    decision: triggerDecisionOutcomeSchema,
    runId: idSchema.nullable(),
    runName: z.string().nullable(),
    reason: z.string().nullable(),
    diagnostic: triggerDecisionDiagnosticSchema.nullable().optional(),
    createdAt: isoDateTimeSchema,
  })
  .superRefine((value, ctx) => {
    const isDevDecision = value.subscriptionKind === 'dev';
    const hasNullSubscriptionId = value.subscriptionId === null;
    if (isDevDecision !== hasNullSubscriptionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: isDevDecision
          ? 'dev decisions must have a null subscriptionId'
          : 'trigger and listener decisions must have a subscriptionId',
        path: ['subscriptionId'],
      });
    }
  });

const triggerEventFacetSchema = z.object({
  value: z.string(),
  count: z.number().int().nonnegative(),
});

const triggerEventDetailSchema = triggerEventSchema.extend({
  decisions: z.array(triggerDecisionSchema),
  replays: z.array(triggerEventReplaySchema),
  decisionsTotalCount: z.number().int().nonnegative().optional(),
  replaysTotalCount: z.number().int().nonnegative().optional(),
});

const admissionDeniedDetailsSchema = z.object({
  workspaceId: idSchema,
  reason: z.string(),
  requiredAction: z
    .object({
      reason: z.string(),
      message: z.string(),
      url: z.string(),
    })
    .optional(),
});
const interpolationFieldSchema = z.enum([
  'run',
  'env',
  'agent.prompt',
  'agent.model',
  'agent.provider',
  'agent.thinking',
  'agent.session',
  'job.runner',
  'job.outputs',
  'job.execution_name',
  'workflow.run_name',
  'step.name',
  'step.working_directory',
  'step.feedback',
  'tool.with',
  'tool.outputs',
  'checkout.project',
  'checkout.connection',
  'checkout.repository',
  'checkout.ref',
  'checkout.path',
]);
const startRunErrors = {
  'workspace-not-found': z.object({workspaceId: idSchema}),
  'workspace-suspended': z.object({workspaceId: idSchema}),
  'workspace-deleted': z.object({workspaceId: idSchema}),
  'admission-denied': admissionDeniedDetailsSchema,
  'definition-not-found': z.object({definitionId: idSchema}),
  'project-mismatch': z.object({}),
  'agent-config-unresolvable': z.object({definitionId: idSchema}),
  'agent-integration-materialization-failed': z.object({}),
  'interpolation-unresolvable': z.object({
    definitionId: idSchema,
    field: interpolationFieldSchema,
    source: z.string(),
    envKey: z.string().optional(),
  }),
  'invalid-job-runner-labels': z.object({labels: z.array(z.string())}),
  'source-snapshot-too-large': z.object({
    limitBytes: z.number().int().positive(),
    measuredBytes: z.number().int().positive(),
  }),
  'diagnostic-too-large': z.object({
    field: workflowDiagnosticFieldSchema,
    limitBytes: z.number().int().positive(),
    measuredBytes: z.number().int().positive(),
  }),
  'workflow-execution-payload-too-large': z.object({
    field: workflowExecutionPayloadFieldSchema,
    limitBytes: z.number().int().positive(),
    measuredBytes: z.number().int().positive(),
    overshootBytes: z.number().int().positive(),
  }),
};
const startDevRunErrors = {
  'workspace-not-found': startRunErrors['workspace-not-found'],
  'workspace-suspended': startRunErrors['workspace-suspended'],
  'workspace-deleted': startRunErrors['workspace-deleted'],
  'admission-denied': startRunErrors['admission-denied'],
  'agent-config-unresolvable': startRunErrors['agent-config-unresolvable'],
  'agent-integration-materialization-failed':
    startRunErrors['agent-integration-materialization-failed'],
  'interpolation-unresolvable': startRunErrors['interpolation-unresolvable'],
  'invalid-job-runner-labels': startRunErrors['invalid-job-runner-labels'],
  'source-snapshot-too-large': startRunErrors['source-snapshot-too-large'],
  'diagnostic-too-large': startRunErrors['diagnostic-too-large'],
  'workflow-execution-payload-too-large': startRunErrors['workflow-execution-payload-too-large'],
};
const definitionResolutionErrors = {
  'project-not-found': z.object({projectId: idSchema}),
  'ref-not-found': z.object({ref: refSchema}),
  'ref-invalid': z.object({ref: refSchema}),
  'ref-moved': z.object({ref: refSchema, expectedCommit: z.string()}),
  'file-not-found': z.object({ref: refSchema, configPath: configPathSchema}),
  'content-too-large': z.object({configPath: configPathSchema}),
  'invalid-definition': z.object({errors: z.array(definitionValidationErrorSchema)}),
  'source-unavailable': z.object({}),
};
const devRunDomainErrors = {
  'trigger-not-found': z.object({triggerKey: z.string()}),
  'inputs-not-allowed': z.object({}),
  'replay-event-required': z.object({source: z.string()}),
  'replay-event-not-allowed': z.object({source: z.string()}),
  'replay-event-not-found': z.object({replayEventId: idSchema}),
  'replay-event-mismatch': z.object({replayEventId: idSchema}),
  'replay-event-unavailable': z.object({replayEventId: idSchema}),
  'trigger-filtered': z.object({reason: z.string()}),
};

export const triggerEventDiagnosticReadLimitsSchema = z
  .object({
    decisions: z.number().int().min(1).max(50),
    replays: z.number().int().min(1).max(20),
  })
  .strict();

export type TriggerEventDiagnosticReadLimits = z.infer<
  typeof triggerEventDiagnosticReadLimitsSchema
>;

export const triggersInterModuleContract = defineInterModuleContract({
  module: 'triggers',
  methods: {
    fireManualTrigger: {
      input: z.object({
        workspaceId: idSchema,
        definitionId: idSchema,
        userId: idSchema,
        inputs: z.record(z.string(), z.unknown()).optional(),
        idempotencyKey: z.string().min(1).optional(),
      }),
      output: z.object({id: idSchema, name: z.string(), deduplicated: z.boolean()}),
      errors: {
        'manual-trigger-not-found': z.object({definitionId: idSchema}),
        ...startRunErrors,
      },
    },
    createDevRun: {
      input: z.object({
        workspaceId: idSchema,
        projectId: idSchema,
        ref: refSchema,
        configPath: configPathSchema,
        triggerKey: z.string().min(1),
        commit: z
          .string()
          .regex(/^[0-9a-f]{40}$/)
          .optional(),
        inputs: z.record(z.string(), z.unknown()).optional(),
        replayEventId: idSchema.optional(),
        userId: idSchema,
      }),
      output: z.object({id: idSchema, commit: z.string()}),
      errors: {
        ...devRunDomainErrors,
        ...definitionResolutionErrors,
        ...startDevRunErrors,
      },
    },
    listTriggerEvents: {
      input: z.object({
        workspaceId: idSchema,
        limit: z.number().int().min(1).max(100),
        cursor: triggerEventCursorSchema.optional(),
        filters: triggerEventListFiltersSchema.optional(),
      }),
      output: z.object({
        events: z.array(triggerEventListItemSchema),
        nextCursor: triggerEventCursorSchema.nullable(),
      }),
    },
    getTriggerEvent: {
      input: z.object({
        workspaceId: idSchema,
        eventId: idSchema,
        diagnostic: triggerEventDiagnosticReadLimitsSchema.optional(),
      }),
      output: triggerEventDetailSchema,
      errors: {
        'trigger-event-not-found': z.object({eventId: idSchema}),
      },
    },
    getTriggerEventFacets: {
      input: z.object({workspaceId: idSchema}),
      output: z.object({
        sources: z.array(triggerEventFacetSchema),
        events: z.array(triggerEventFacetSchema),
        origins: z.array(triggerEventFacetSchema),
      }),
    },
  },
});

export type TriggersInterModuleClient = InterModuleClient<typeof triggersInterModuleContract>;
export type TriggerEventListItem = z.infer<typeof triggerEventListItemSchema>;
export type TriggerEventDetail = z.infer<typeof triggerEventDetailSchema>;
export type TriggerDecision = z.infer<typeof triggerDecisionSchema>;
export type TriggerEventReplay = z.infer<typeof triggerEventReplaySchema>;
