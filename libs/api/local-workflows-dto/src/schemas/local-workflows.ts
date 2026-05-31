import {z} from 'zod';

const passThroughObjectSchema = z.object({}).passthrough();

export const foxlangRunStatusSchema = z.enum([
  'completed',
  'source_invalid',
  'input_rejected',
  'runner_failed',
]);
export type FoxlangRunStatusDto = z.infer<typeof foxlangRunStatusSchema>;

export const triggerFakeAlertBodySchema = z.object({
  id: z.string().min(1).max(200),
  severity: z.enum(['critical', 'warning']),
  message: z.string().min(1).max(1000),
});
export type TriggerFakeAlertBodyDto = z.infer<typeof triggerFakeAlertBodySchema>;

export const foxlangFakeMonitoringAlertRequestSchema = triggerFakeAlertBodySchema.extend({
  run_id: z.string().min(1).max(300).optional(),
});
export type FoxlangFakeMonitoringAlertRequestDto = z.infer<
  typeof foxlangFakeMonitoringAlertRequestSchema
>;

export type FoxlangBridgeValueDto =
  | {kind: 'string'; value: string}
  | {kind: 'int'; value: number}
  | {kind: 'list'; items: FoxlangBridgeValueDto[]}
  | {kind: 'record'; fields: Array<{name: string; value: FoxlangBridgeValueDto}>};

export const foxlangBridgeValueSchema: z.ZodType<FoxlangBridgeValueDto> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({kind: z.literal('string'), value: z.string()}).passthrough(),
    z.object({kind: z.literal('int'), value: z.number().int()}).passthrough(),
    z.object({kind: z.literal('list'), items: z.array(foxlangBridgeValueSchema)}).passthrough(),
    z
      .object({
        kind: z.literal('record'),
        fields: z.array(z.object({name: z.string(), value: foxlangBridgeValueSchema})),
      })
      .passthrough(),
  ]),
);

export const foxlangRunRecordSchema = z
  .object({
    run_id: z.string(),
    module_id: z.string().optional(),
    module_name: z.string().optional(),
    trigger_id: z.string().optional(),
    trigger_name: z.string().optional(),
    workflow_id: z.string().optional(),
    workflow_name: z.string().optional(),
    provider_event_id: z.string().optional(),
    status: z.string(),
  })
  .passthrough();
export type FoxlangRunRecordDto = z.infer<typeof foxlangRunRecordSchema>;

export const foxlangActionRecordSchema = z
  .object({
    action_requirement_id: z.string().optional(),
    argv: z.array(z.string()).optional(),
    status: z.string(),
    exit_code: z.number().int().nullable().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  })
  .passthrough();
export type FoxlangActionRecordDto = z.infer<typeof foxlangActionRecordSchema>;

export const foxlangRunGraphSchema = z
  .object({
    run: foxlangRunRecordSchema,
    trigger_evidence: passThroughObjectSchema.optional(),
    workflow_invocation: passThroughObjectSchema.optional(),
    actions: z.array(foxlangActionRecordSchema).default([]),
    workflow_return_claim: passThroughObjectSchema.optional(),
    events: z.array(passThroughObjectSchema).default([]),
  })
  .passthrough();
export type FoxlangRunGraphDto = z.infer<typeof foxlangRunGraphSchema>;

export const foxlangExecutionResponseSchema = z
  .object({
    status: foxlangRunStatusSchema,
    run: foxlangRunGraphSchema.optional(),
    input_error: passThroughObjectSchema.optional(),
    diagnostics: z.array(passThroughObjectSchema).optional(),
    failure: passThroughObjectSchema.optional(),
  })
  .passthrough();
export type FoxlangExecutionResponseDto = z.infer<typeof foxlangExecutionResponseSchema>;

export const foxlangWorkflowListItemSchema = z
  .object({
    preparation_id: z.string(),
    registered_at: z.string().optional(),
    workflow: passThroughObjectSchema,
    triggers: z.array(passThroughObjectSchema).default([]),
    action_requirements: z.array(passThroughObjectSchema).default([]),
  })
  .passthrough();

export const foxlangWorkflowListResponseSchema = z
  .object({
    workflows: z.array(foxlangWorkflowListItemSchema),
  })
  .passthrough();
export type FoxlangWorkflowListResponseDto = z.infer<typeof foxlangWorkflowListResponseSchema>;

export const foxlangWorkflowDetailResponseSchema = z
  .object({
    preparation_id: z.string(),
    registered_at: z.string().optional(),
    workflow: passThroughObjectSchema,
    module: passThroughObjectSchema.optional(),
    triggers: z.array(passThroughObjectSchema).default([]),
    required_services: z.array(passThroughObjectSchema).default([]),
    action_requirements: z.array(passThroughObjectSchema).default([]),
    source: z
      .object({
        source_name: z.string().optional(),
        source_text: z.string().optional(),
      })
      .passthrough(),
    iface_text: z.string().optional(),
  })
  .passthrough();
export type FoxlangWorkflowDetailResponseDto = z.infer<typeof foxlangWorkflowDetailResponseSchema>;

export const foxlangRunListResponseSchema = z
  .object({
    runs: z.array(foxlangRunRecordSchema),
  })
  .passthrough();
export type FoxlangRunListResponseDto = z.infer<typeof foxlangRunListResponseSchema>;

export const foxlangRunDetailResponseSchema = foxlangExecutionResponseSchema;
export type FoxlangRunDetailResponseDto = z.infer<typeof foxlangRunDetailResponseSchema>;

export const foxlangLocalServiceErrorResponseSchema = z
  .object({
    error: z
      .object({
        kind: z.string(),
        message: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type FoxlangLocalServiceErrorResponseDto = z.infer<
  typeof foxlangLocalServiceErrorResponseSchema
>;

export const localWorkflowServiceErrorCodeSchema = z.enum([
  'local-service-unavailable',
  'local-service-timeout',
  'local-service-malformed-response',
  'local-service-error',
  'local-service-input-rejected',
]);
export type LocalWorkflowServiceErrorCodeDto = z.infer<typeof localWorkflowServiceErrorCodeSchema>;

export const localWorkflowStatusSchema = z.object({
  base_url: z.string(),
  reachable: z.boolean(),
  latest_fake_alert: foxlangExecutionResponseSchema.nullable(),
  setup_hint: z.string().nullable(),
});
export type LocalWorkflowStatusDto = z.infer<typeof localWorkflowStatusSchema>;

export const localWorkflowListSchema = foxlangWorkflowListResponseSchema;
export type LocalWorkflowListDto = z.infer<typeof localWorkflowListSchema>;

export const localWorkflowDetailSchema = foxlangWorkflowDetailResponseSchema;
export type LocalWorkflowDetailDto = z.infer<typeof localWorkflowDetailSchema>;

export const localWorkflowRunListSchema = foxlangRunListResponseSchema;
export type LocalWorkflowRunListDto = z.infer<typeof localWorkflowRunListSchema>;

export const localWorkflowRunDetailSchema = foxlangRunDetailResponseSchema;
export type LocalWorkflowRunDetailDto = z.infer<typeof localWorkflowRunDetailSchema>;

export const triggerFakeAlertResponseSchema = z
  .object({
    run_id: z.string(),
    result: foxlangExecutionResponseSchema,
  })
  .passthrough();
export type TriggerFakeAlertResponseDto = z.infer<typeof triggerFakeAlertResponseSchema>;
