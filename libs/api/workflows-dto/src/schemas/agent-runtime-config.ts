import {z} from 'zod';

/** Marks a runtime config re-fetch of a running step, for renewals and bounded telemetry. */
export const AGENT_RUNTIME_CONFIG_RENEWAL_HEADER = 'x-shipfox-runtime-config-renewal';

export const agentRuntimeConfigQuerySchema = z.object({
  step_id: z.string().uuid(),
  attempt: z.coerce.number().int().positive(),
});

export type AgentRuntimeConfigQueryDto = z.infer<typeof agentRuntimeConfigQuerySchema>;
