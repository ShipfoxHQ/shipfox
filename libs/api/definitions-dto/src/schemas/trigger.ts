import {secretKeySchema} from '@shipfox/api-secrets-dto';
import {z} from 'zod';

export const triggerDtoSchema = z.object({
  source: z.string(),
  event: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(secretKeySchema, secretKeySchema).optional(),
  filter: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type TriggerDto = z.infer<typeof triggerDtoSchema>;
