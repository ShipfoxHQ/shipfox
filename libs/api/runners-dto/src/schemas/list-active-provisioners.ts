import {z} from 'zod';

export const activeProvisionerDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  prefix: z.string(),
  last_seen_at: z.string(),
});

export const listActiveProvisionersResponseSchema = z.object({
  provisioners: z.array(activeProvisionerDtoSchema),
});

export type ActiveProvisionerDto = z.infer<typeof activeProvisionerDtoSchema>;
export type ListActiveProvisionersResponseDto = z.infer<
  typeof listActiveProvisionersResponseSchema
>;
