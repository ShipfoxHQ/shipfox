import {z} from 'zod';

export const triggerSchema = z.object({
  source: z.string(),
  event: z.string(),
  on: z.union([z.string(), z.array(z.string())]).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  filter: z.string().optional(),
});

export type TriggerDto = z.infer<typeof triggerSchema>;
