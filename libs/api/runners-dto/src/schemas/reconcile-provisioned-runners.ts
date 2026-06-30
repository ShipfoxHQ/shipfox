import {z} from 'zod';
import {provisionedRunnerStateSchema} from './report-provisioned-runners.js';

export const MAX_RECONCILE_OBSERVED_RUNNERS = 5000;
export const MAX_OBSERVED_PROVISIONED_RUNNER_ID_LENGTH = 255;

export const reconcileProvisionedRunnersBodySchema = z
  .object({
    observed_provisioned_runner_ids: z
      .array(z.string().min(1).max(MAX_OBSERVED_PROVISIONED_RUNNER_ID_LENGTH))
      .max(MAX_RECONCILE_OBSERVED_RUNNERS),
  })
  .strict()
  .refine(
    (body) =>
      new Set(body.observed_provisioned_runner_ids).size ===
      body.observed_provisioned_runner_ids.length,
    {
      message: 'observed_provisioned_runner_ids values must be unique',
      path: ['observed_provisioned_runner_ids'],
    },
  );

export const reconcileDesiredIntentSchema = z.enum(['keep', 'terminate']);

export const reconciledBoundJobSchema = z
  .object({
    job_id: z.string().uuid(),
    run_id: z.string().uuid(),
    last_heartbeat_at: z.string().datetime(),
    cancellation_requested_at: z.string().datetime().nullable(),
  })
  .strict();

export const reconciledProvisionedRunnerSchema = z
  .object({
    provisioned_runner_id: z.string(),
    state: provisionedRunnerStateSchema.nullable(),
    reservation_id: z.string().uuid().nullable(),
    runner_session_id: z.string().uuid().nullable(),
    bound_job: reconciledBoundJobSchema.nullable(),
    desired_intent: reconcileDesiredIntentSchema,
  })
  .strict();

export const reconcileProvisionedRunnersResponseSchema = z
  .object({
    runners: z.array(reconciledProvisionedRunnerSchema),
    terminated_absent_provisioned_runner_ids: z.array(z.string()),
  })
  .strict();

export type ReconcileProvisionedRunnersBodyDto = z.infer<
  typeof reconcileProvisionedRunnersBodySchema
>;
export type ReconcileDesiredIntentDto = z.infer<typeof reconcileDesiredIntentSchema>;
export type ReconciledBoundJobDto = z.infer<typeof reconciledBoundJobSchema>;
export type ReconciledProvisionedRunnerDto = z.infer<typeof reconciledProvisionedRunnerSchema>;
export type ReconcileProvisionedRunnersResponseDto = z.infer<
  typeof reconcileProvisionedRunnersResponseSchema
>;
