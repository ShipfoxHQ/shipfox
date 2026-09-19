import {z} from 'zod';
import {runnerJobStopReasonSchema} from './reconcile-runner-instances.js';
export const heartbeatBodySchema = z.object({});

export const heartbeatResponseSchema = z.object({
  cancel: z.boolean(),
  lease_token: z.string().min(1),
  // Optional for compatibility with older runner API responses.
  cancellation_reason: runnerJobStopReasonSchema.nullable().optional(),
});

export type HeartbeatBodyDto = z.infer<typeof heartbeatBodySchema>;
export type HeartbeatResponseDto = z.infer<typeof heartbeatResponseSchema>;
