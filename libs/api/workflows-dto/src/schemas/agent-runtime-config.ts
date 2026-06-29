import {z} from 'zod';

export const agentRuntimeConfigQuerySchema = z.object({
  step_id: z.string().uuid(),
  attempt: z.coerce.number().int().positive(),
});

export type AgentRuntimeConfigQueryDto = z.infer<typeof agentRuntimeConfigQuerySchema>;
