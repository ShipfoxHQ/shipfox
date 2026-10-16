import {z} from 'zod';
import {runnerJobStopReasonSchema} from './reconcile-runner-instances.js';

/** Maximum number of step-scoped lease tokens one heartbeat renews. */
export const HEARTBEAT_STEP_LEASE_TOKENS_MAX = 64;

export const heartbeatBodySchema = z.object({
  // The step-scoped tokens the runner holds for its running steps. Each valid one comes back
  // renewed in `step_lease_tokens`.
  step_lease_tokens: z.array(z.string().min(1)).max(HEARTBEAT_STEP_LEASE_TOKENS_MAX).optional(),
});

export const heartbeatStepLeaseTokenSchema = z.object({
  step_id: z.string().uuid(),
  attempt: z.number().int().positive(),
  lease_token: z.string().min(1),
});

export const heartbeatResponseSchema = z.object({
  cancel: z.boolean(),
  lease_token: z.string().min(1),
  // Optional for compatibility with older runner API responses, like `cancellation_reason`.
  step_lease_tokens: z.array(heartbeatStepLeaseTokenSchema).default([]),
  // Optional for compatibility with older runner API responses.
  cancellation_reason: runnerJobStopReasonSchema.nullable().optional(),
});

export type HeartbeatBodyDto = z.infer<typeof heartbeatBodySchema>;
export type HeartbeatStepLeaseTokenDto = z.infer<typeof heartbeatStepLeaseTokenSchema>;
export type HeartbeatResponseDto = z.infer<typeof heartbeatResponseSchema>;
