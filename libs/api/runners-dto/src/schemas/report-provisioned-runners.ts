import {MAX_RUNNER_LABELS} from '@shipfox/runner-labels';
import {z} from 'zod';
import {runnerLabelSchema} from './register.js';

export const MAX_PROVISIONED_RUNNER_REPORT_EVENTS = 1000;
export const MAX_PROVISIONED_RUNNER_REASON_LENGTH = 500;
export const MAX_PROVIDER_KIND_LENGTH = 64;

export const provisionedRunnerStateSchema = z.enum([
  'starting',
  'running',
  'stopping',
  'stopped',
  'failed',
  'terminated',
]);

export const providerKindSchema = z.string().min(1).max(MAX_PROVIDER_KIND_LENGTH);

export const provisionedRunnerReportEventSchema = z
  .object({
    provisioned_runner_id: z.string().min(1).max(255),
    reservation_id: z.string().uuid().optional(),
    template_key: z.string().min(1).max(255).optional(),
    labels: z.array(runnerLabelSchema).min(1).max(MAX_RUNNER_LABELS),
    state: provisionedRunnerStateSchema,
    reason: z.string().min(1).max(MAX_PROVISIONED_RUNNER_REASON_LENGTH).optional(),
    runner_session_id: z.string().uuid().optional(),
    reported_at: z.string().datetime(),
    provider_kind: providerKindSchema.optional(),
  })
  .strict();

export const reportProvisionedRunnersBodySchema = z.object({
  events: z
    .array(provisionedRunnerReportEventSchema)
    .min(1)
    .max(MAX_PROVISIONED_RUNNER_REPORT_EVENTS),
});

export const reportProvisionedRunnersResponseSchema = z.object({
  accepted: z.number().int().min(0),
  reservations_released: z.number().int().min(0),
});

export const createPlannedCapacityBodySchema = z
  .object({
    provider_kind: providerKindSchema.optional(),
    template_key: z.string().min(1).max(255).optional(),
  })
  .strict();

export const createPlannedCapacityResponseSchema = z.object({
  capacity_id: z.string().uuid(),
  bootstrap_credential: z.string().min(1),
});

export const attachProviderRunnerBodySchema = z
  .object({provisioned_runner_id: z.string().min(1).max(255)})
  .strict();

export const attachProviderRunnerResponseSchema = z.object({attached: z.boolean()});

export const activeRunnerStateSchema = z.enum(['starting', 'running', 'stopping', 'busy']);

export const activeRunnerDtoSchema = z.object({
  runner_session_id: z.string().uuid().nullable(),
  provisioned_runner_id: z.string().nullable(),
  provisioner_id: z.string().uuid().nullable(),
  state: activeRunnerStateSchema,
  labels: z.array(z.string()),
  template_key: z.string().nullable(),
  provider_kind: z.string().nullable(),
  job_id: z.string().uuid().nullable(),
  workflow_run_attempt_id: z.string().uuid().nullable(),
  project_id: z.string().uuid().nullable(),
  reported_at: z.string().nullable(),
  last_heartbeat_at: z.string().nullable(),
});

export const activeRunnersResponseSchema = z.object({
  runners: z.array(activeRunnerDtoSchema),
});

export type ProvisionedRunnerStateDto = z.infer<typeof provisionedRunnerStateSchema>;
export type ProvisionedRunnerReportEventDto = z.infer<typeof provisionedRunnerReportEventSchema>;
export type ReportProvisionedRunnersBodyDto = z.infer<typeof reportProvisionedRunnersBodySchema>;
export type ReportProvisionedRunnersResponseDto = z.infer<
  typeof reportProvisionedRunnersResponseSchema
>;
export type CreatePlannedCapacityBodyDto = z.infer<typeof createPlannedCapacityBodySchema>;
export type CreatePlannedCapacityResponseDto = z.infer<typeof createPlannedCapacityResponseSchema>;
export type AttachProviderRunnerBodyDto = z.infer<typeof attachProviderRunnerBodySchema>;
export type AttachProviderRunnerResponseDto = z.infer<typeof attachProviderRunnerResponseSchema>;
export type ActiveRunnerStateDto = z.infer<typeof activeRunnerStateSchema>;
export type ActiveRunnerDto = z.infer<typeof activeRunnerDtoSchema>;
export type ActiveRunnersResponseDto = z.infer<typeof activeRunnersResponseSchema>;
