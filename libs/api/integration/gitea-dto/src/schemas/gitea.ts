import {integrationConnectionDtoSchema} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const createGiteaConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  org: z.string().min(1),
});
export type CreateGiteaConnectionBodyDto = z.infer<typeof createGiteaConnectionBodySchema>;

export const createGiteaConnectionResponseSchema = integrationConnectionDtoSchema;
export type CreateGiteaConnectionResponseDto = z.infer<typeof createGiteaConnectionResponseSchema>;
