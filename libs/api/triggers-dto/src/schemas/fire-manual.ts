import {z} from 'zod';

export const fireManualTriggerBodySchema = z
  .object({
    inputs: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type FireManualTriggerBodyDto = z.infer<typeof fireManualTriggerBodySchema>;

export const fireManualTriggerResponseSchema = z
  .object({
    workflow_run_id: z.string().uuid(),
  })
  .strict();

export type FireManualTriggerResponseDto = z.infer<typeof fireManualTriggerResponseSchema>;
