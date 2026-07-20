import {MAX_RUNNER_LABELS} from '@shipfox/runner-labels';
import {z} from 'zod';
import {runnerLabelSchema} from './register.js';
import {providerKindSchema} from './report-provisioned-runners.js';

export const exchangeCapacityBootstrapBodySchema = z.object({}).strict();
export const capacitySessionResponseSchema = z.object({
  session_token: z.string().min(1),
  session_id: z.string().uuid(),
  capacity_id: z.string().uuid(),
});
export const declareCapacityBodySchema = z
  .object({
    labels: z.array(runnerLabelSchema).min(1).max(MAX_RUNNER_LABELS),
    provider_kind: providerKindSchema.optional(),
  })
  .strict();
export const declareCapacityResponseSchema = z.object({accepted: z.boolean()});
export const capacityHeartbeatResponseSchema = z.object({ok: z.literal(true)});

export type CapacitySessionResponseDto = z.infer<typeof capacitySessionResponseSchema>;
export type DeclareCapacityBodyDto = z.infer<typeof declareCapacityBodySchema>;
