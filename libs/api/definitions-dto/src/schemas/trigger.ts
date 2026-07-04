import {z} from 'zod';

export const triggerDtoSchema = z.object({
  source: z.string(),
  event: z.string(),
  with: z.record(z.string(), z.unknown()).optional(),
  filter: z.string().optional(),
  schedule: z.string().optional(),
  timezone: z.string().optional(),
});
export type TriggerDto = z.infer<typeof triggerDtoSchema>;
